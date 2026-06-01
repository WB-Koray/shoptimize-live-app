"""
shoptimize-live-app — Bağımsız Live Activity servisi.
Mevcut shoptimize backend'e dokunmadan çalışır.

Port: 8001 (Coolify'da ayarlanacak)
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from services.redis_store import store
from routers import live
from routers import auth
from routers import gdpr
from routers import billing
from routers import flow
from routers import admin


async def _abandoned_checkout_worker():
    import asyncio
    import time
    import logging
    import datetime
    from services.wa_sender import send_wa_template
    _log = logging.getLogger(__name__)
    while True:
        try:
            await asyncio.sleep(60)
            now_ms = time.time() * 1000
            pending = await store.get_pending_checkouts_before(int(now_ms))
            for token in pending:
                co = await store.get_checkout(token)
                if not co:
                    continue
                if await store.is_checkout_completed(token):
                    await store.remove_pending_checkout(token)
                    continue
                username = co.get("username", "")
                brand    = co.get("brand", "default")
                settings = await store.get_flow_settings(username, brand)
                if not settings.get("enabled"):
                    continue
                wa_token      = settings.get("wa_token", "")
                phone_id      = settings.get("phone_number_id", "")
                phone         = co.get("phone", "")
                cooldown_hours    = int(settings.get("cooldown_hours", 48))
                min_cart_value    = float(settings.get("min_cart_value", 0))
                send_window_start = int(settings.get("send_window_start", 9))
                send_window_end   = int(settings.get("send_window_end", 21))
                if not wa_token or not phone_id or not phone:
                    continue

                # Gönderim penceresi kontrolü (Türkiye saati UTC+3)
                tr_hour = (datetime.datetime.utcnow().hour + 3) % 24
                if send_window_start < send_window_end:
                    outside_window = tr_hour < send_window_start or tr_hour >= send_window_end
                else:
                    outside_window = tr_hour < send_window_start and tr_hour >= send_window_end
                if outside_window:
                    continue

                # Minimum sepet tutarı kontrolü
                if min_cart_value > 0:
                    cart_total = float(co.get("total_price", 0) or 0)
                    if cart_total < min_cart_value:
                        await store.remove_pending_checkout(token)
                        _log.info("[FLOW] ⏭ Sepet tutarı eşiğin altında — token=%s… total=%.2f min=%.2f", token[:8], cart_total, min_cart_value)
                        continue

                # Telefon bazlı aktif sequence kontrolü — duplicate checkout tokenlarını önle
                active_token = await store.get_phone_active_token(phone)
                if active_token and active_token != token:
                    # Bu telefon için başka bir sequence zaten aktif → tüm adımları atla
                    log_key = f"cooldown_logged:{token}"
                    if not await store._redis.exists(log_key):
                        await store.append_flow_log(username, brand, {
                            "ts": int(now_ms), "token": token,
                            "phone": "***" + phone[-4:], "name": co.get("name", ""),
                            "product": co.get("product", ""), "ok": False,
                            "step": -1, "step_label": "Cooldown",
                            "status": "cooldown_skip",
                            "error": f"Aktif sequence devam ediyor — {cooldown_hours}s bekleniyor",
                        })
                        await store._redis.setex(log_key, 86400, "1")
                        _log.info("[FLOW] ⏸ Cooldown atlandı — telefon=%s aktif=%s…", "***" + phone[-4:], active_token[:8])
                    await store.remove_pending_checkout(token)
                    continue

                # Sequence: [{delay_minutes, template, enabled, label}, ...]
                sequence = settings.get("sequence") or [{
                    "delay_minutes": settings.get("delay_minutes", 15),
                    "template": "sepet_hatirlatma",
                    "enabled": True,
                    "label": "İlk hatırlatma",
                }]

                products    = co.get("line_items", [])
                checkout_ts = co.get("ts", 0)
                # Son aktif adımı bul (sequence tamamlanma kontrolü için)
                enabled_step_indices = [i for i, s in enumerate(sequence) if s.get("enabled")]
                last_enabled_idx = enabled_step_indices[-1] if enabled_step_indices else -1

                for step_idx, step in enumerate(sequence):
                    if not step.get("enabled"):
                        continue
                    step_delay_ms = step.get("delay_minutes", 15) * 60 * 1000
                    if now_ms - checkout_ts < step_delay_ms:
                        continue
                    if await store.is_step_sent(token, step_idx):
                        continue

                    tmpl = step.get("template", "sepet_hatirlatma")
                    lang = step.get("language", "tr")
                    result = await send_wa_template(
                        wa_token, phone_id, phone,
                        name=co.get("name", ""), product=co.get("product", ""),
                        template_name=tmpl, language=lang, products=products,
                    )
                    await store.mark_step_sent(token, step_idx)

                    # İlk adım başarıyla gönderildiğinde telefonu aktif sequence'a kaydet
                    if step_idx == 0 and result.get("ok"):
                        await store.set_phone_active_token(phone, token, cooldown_hours)

                    # Son adım gönderildiyse pending checkout'u kaldır — tekrar tetiklenmesin
                    if step_idx == last_enabled_idx and result.get("ok"):
                        await store.remove_pending_checkout(token)
                        _log.info("[FLOW] ✓ Sequence tamamlandı — token=%s… checkout kaldırıldı", token[:8])

                    entry = {
                        "ts": int(now_ms), "token": token,
                        "phone": "***" + phone[-4:], "name": co.get("name", ""),
                        "product": co.get("product", ""), "ok": result.get("ok"),
                        "message_id": result.get("message_id", ""),
                        "error": result.get("error", ""),
                        "step": step_idx,
                        "step_label": step.get("label", f"Adım {step_idx + 1}"),
                        "opted_out": result.get("opted_out", False),
                    }
                    if not result.get("opted_out"):
                        await store.append_flow_log(username, brand, entry)
                        status = "✓" if result.get("ok") else "✗"
                        _log.info("[FLOW] %s [%s] WA→%s token=%s…", status, step.get("label", f"adım{step_idx}"), "***" + phone[-4:], token[:8])
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("[FLOW] Worker hatası: %s", e)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await store.connect()
    await store.warmup_tid_cache()
    import asyncio
    asyncio.create_task(_abandoned_checkout_worker())
    yield
    # Shutdown
    await store.disconnect()


app = FastAPI(
    title="Shoptimize Live Activity",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS — pixel.js ve /api/live/event herkese açık olmalı
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)

app.include_router(live.router)
app.include_router(auth.router)
app.include_router(gdpr.router)
app.include_router(billing.router)
app.include_router(flow.router)
app.include_router(admin.router)


@app.get("/health")
async def health():
    return {"ok": True, "service": "shoptimize-live"}


@app.get("/start", response_class=HTMLResponse)
async def start_guide():
    """Kurulum rehberi — Shopify listing ve WA mesajlarında paylaşılabilir."""
    return """<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Shoptimize Live — Başlangıç Rehberi</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
           background: #0d1117; color: #e6edf3; line-height: 1.7; min-height: 100vh; }
    .hero { background: linear-gradient(135deg, #1a2f1a 0%, #0d1117 60%);
            padding: 64px 24px 48px; text-align: center; border-bottom: 1px solid #21262d; }
    .logo { width: 72px; height: 72px; border-radius: 20px; margin: 0 auto 20px;
            background: linear-gradient(135deg, #5a7a3c, #3e8d7a);
            display: flex; align-items: center; justify-content: center;
            font-size: 2rem; }
    h1 { font-size: clamp(1.8rem, 4vw, 2.8rem); font-weight: 800;
         background: linear-gradient(135deg, #7ec858, #56c4a4); -webkit-background-clip: text;
         -webkit-text-fill-color: transparent; background-clip: text; margin-bottom: 12px; }
    .subtitle { font-size: 1.1rem; color: #8b949e; max-width: 520px; margin: 0 auto 32px; }
    .cta-btn { display: inline-flex; align-items: center; gap: 8px; padding: 14px 28px;
               background: linear-gradient(135deg, #5a7a3c, #3e8d7a); color: #fff;
               border-radius: 12px; font-weight: 700; font-size: 0.95rem; text-decoration: none;
               box-shadow: 0 4px 20px rgba(90,122,60,0.3); transition: opacity 0.2s; }
    .cta-btn:hover { opacity: 0.88; }
    .container { max-width: 820px; margin: 0 auto; padding: 48px 24px 80px; }
    .section { margin-bottom: 48px; }
    h2 { font-size: 1.3rem; font-weight: 700; color: #e6edf3; margin-bottom: 20px;
         display: flex; align-items: center; gap: 10px; }
    .step-grid { display: grid; gap: 16px; }
    .step { background: #161b22; border: 1px solid #21262d; border-radius: 16px; padding: 20px 24px;
            display: flex; gap: 16px; align-items: flex-start; }
    .step-num { min-width: 36px; height: 36px; border-radius: 50%;
                background: linear-gradient(135deg, #5a7a3c, #3e8d7a);
                display: flex; align-items: center; justify-content: center;
                font-weight: 800; font-size: 0.9rem; color: #fff; flex-shrink: 0; }
    .step-content h3 { font-size: 1rem; font-weight: 700; color: #e6edf3; margin-bottom: 4px; }
    .step-content p { font-size: 0.9rem; color: #8b949e; }
    .step-content code { background: #21262d; padding: 2px 6px; border-radius: 4px;
                          font-family: monospace; font-size: 0.85rem; color: #79c0ff; }
    .feature-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 14px; }
    .feature { background: #161b22; border: 1px solid #21262d; border-radius: 14px; padding: 18px; }
    .feature-icon { font-size: 1.5rem; margin-bottom: 8px; }
    .feature h3 { font-size: 0.95rem; font-weight: 700; color: #e6edf3; margin-bottom: 4px; }
    .feature p { font-size: 0.85rem; color: #8b949e; }
    .faq { background: #161b22; border: 1px solid #21262d; border-radius: 16px; overflow: hidden; }
    .faq-item { padding: 18px 24px; border-bottom: 1px solid #21262d; }
    .faq-item:last-child { border-bottom: none; }
    .faq-q { font-weight: 700; color: #e6edf3; font-size: 0.95rem; margin-bottom: 6px; }
    .faq-a { color: #8b949e; font-size: 0.9rem; }
    .login-box { background: #161b22; border: 1px solid #30363d; border-radius: 16px; padding: 28px;
                 text-align: center; }
    .login-box h3 { font-size: 1.1rem; font-weight: 700; margin-bottom: 8px; }
    .login-box p { color: #8b949e; font-size: 0.9rem; margin-bottom: 20px; }
    .login-link { display: inline-flex; align-items: center; gap-6px; padding: 12px 24px;
                  background: #21262d; border: 1px solid #30363d; color: #e6edf3;
                  border-radius: 10px; font-weight: 600; text-decoration: none; font-size: 0.9rem;
                  transition: border-color 0.2s; }
    .login-link:hover { border-color: #7ec858; }
    footer { text-align: center; padding: 24px; color: #484f58; font-size: 0.85rem;
             border-top: 1px solid #21262d; }
    footer a { color: #56c4a4; text-decoration: none; }
  </style>
</head>
<body>

<div class="hero">
  <div class="logo">⚡</div>
  <h1>Shoptimize Live</h1>
  <p class="subtitle">Shopify mağazanızdaki anlık ziyaretçi aktivitesini takip edin, terk edilmiş sepetleri WhatsApp ile geri kazanın.</p>
  <a href="/" class="cta-btn">📊 Dashboard'a Git</a>
</div>

<div class="container">

  <div class="section">
    <h2>✨ Neler Yapabilirsiniz?</h2>
    <div class="feature-grid">
      <div class="feature">
        <div class="feature-icon">👁️</div>
        <h3>Anlık Ziyaretçi Takibi</h3>
        <p>Şu an kim mağazanızda, hangi ürünü inceliyor, nereden geliyor — canlı olarak görün.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">💬</div>
        <h3>WhatsApp Otomasyonu</h3>
        <p>Sepete ürün ekliyip ayrılan müşterilere otomatik WhatsApp mesajı gönderin.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">📈</div>
        <h3>Dönüşüm Hunisi</h3>
        <p>Hangi ürünler en çok bakılıyor, nereden çıkılıyor? Analitik dashboard ile takip edin.</p>
      </div>
      <div class="feature">
        <div class="feature-icon">🔔</div>
        <h3>Anlık Bildirimler</h3>
        <p>Yeni sipariş geldiğinde tarayıcınıza bildirim alın.</p>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>🚀 Kurulum Adımları</h2>
    <div class="step-grid">
      <div class="step">
        <div class="step-num">1</div>
        <div class="step-content">
          <h3>Shopify App Store'dan Kurun</h3>
          <p>Shoptimize Live uygulamasını Shopify mağazanıza ekleyin. Kurulum tamamen otomatiktir — pixel ve webhook'lar anında devreye girer.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">2</div>
        <div class="step-content">
          <h3>Aboneliği Onaylayın</h3>
          <p>7 günlük ücretsiz deneme sonrasında aylık planı Shopify üzerinden onaylayın. İstediğiniz zaman iptal edebilirsiniz.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">3</div>
        <div class="step-content">
          <h3>Dashboard'a Giriş Yapın</h3>
          <p>Kurulum tamamlanınca otomatik olarak dashboard'a yönlendirilirsiniz. Sonraki girişler için <code>live.shoptimize.com.tr</code> adresine gidin ve <strong>Shopify ile Giriş Yap</strong>'ı kullanın.</p>
        </div>
      </div>
      <div class="step">
        <div class="step-num">4</div>
        <div class="step-content">
          <h3>WhatsApp Entegrasyonu (Opsiyonel)</h3>
          <p>Dashboard'da <strong>WA Otomasyonu</strong> sekmesine gidin. Meta WhatsApp Business API token'ınızı ve telefon numarası ID'nizi girin. Terk edilmiş sepet hatırlatma mesajlarını ayarlayın.</p>
        </div>
      </div>
    </div>
  </div>

  <div class="section">
    <h2>❓ Sık Sorulan Sorular</h2>
    <div class="faq">
      <div class="faq-item">
        <div class="faq-q">Dashboard'a nasıl tekrar giriş yaparım?</div>
        <div class="faq-a">live.shoptimize.com.tr adresine gidin ve "Shopify ile Giriş Yap" butonuna tıklayın. Mağaza adresinizi yazın (örnek: <code>mystore.myshopify.com</code>) — Shopify hesabınızla otomatik giriş yapılır.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">Pixel nedir, ne işe yarar?</div>
        <div class="faq-a">Pixel, mağazanıza eklenen küçük bir JavaScript kodudur. Ziyaretçi aktivitesini (sayfa görüntüleme, ürün inceleme, sepete ekleme vb.) takip eder ve dashboard'a iletir.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">WhatsApp entegrasyonu için ne gerekiyor?</div>
        <div class="faq-a">Meta WhatsApp Business API erişimine ihtiyacınız var. Meta Business Manager üzerinden başvurabilirsiniz. Onaylı mesaj şablonları (sepet_hatirlatma vb.) gereklidir.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">Verilerim ne kadar saklanır?</div>
        <div class="faq-a">Ziyaretçi aktivite verileri 7 gün saklanır. Uygulama kaldırıldığında tüm veriler 48 saat içinde silinir.</div>
      </div>
      <div class="faq-item">
        <div class="faq-q">Sorun yaşarsam ne yapmalıyım?</div>
        <div class="faq-a">Dashboard'daki pixel durumunu kontrol edin. Yeşil ise sorun yok demektir. Devam eden sorunlar için destek alın.</div>
      </div>
    </div>
  </div>

  <div class="login-box">
    <h3>Dashboard'a Erişin</h3>
    <p>Mağazanızı zaten kurdunuz mu? Dashboard'a giriş yapın.</p>
    <a href="/" class="login-link">Dashboard'a Git →</a>
  </div>

</div>

<footer>
  <p>Shoptimize Live &copy; 2026 &nbsp;|&nbsp; <a href="/privacy">Gizlilik Politikası</a></p>
</footer>

</body>
</html>"""


@app.get("/privacy", response_class=HTMLResponse)
async def privacy_policy():
    return """<!DOCTYPE html>
<html lang="tr">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Gizlilik Politikası — Shoptimize Live</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
           max-width: 760px; margin: 60px auto; padding: 0 24px;
           color: #1a1a1a; line-height: 1.7; }
    h1 { font-size: 2rem; margin-bottom: 4px; }
    h2 { font-size: 1.15rem; margin-top: 2rem; }
    .updated { color: #666; font-size: 0.9rem; margin-bottom: 2rem; }
    a { color: #008060; }
  </style>
</head>
<body>
  <h1>Gizlilik Politikası</h1>
  <p class="updated">Son güncelleme: Nisan 2026</p>

  <h2>1. Toplanan Veriler</h2>
  <p>Shoptimize Live, Shopify mağazanızdaki ziyaretçi etkinliğini izlemek amacıyla aşağıdaki verileri toplar:</p>
  <ul>
    <li>Anonim ziyaretçi kimliği (tarayıcı oturumu bazlı, kişisel bilgi içermez)</li>
    <li>Görüntülenen sayfa URL'leri</li>
    <li>Ürün görüntüleme ve sepete ekleme olayları</li>
    <li>Trafik kaynağı ve UTM parametreleri</li>
    <li>Sipariş tamamlama olayları (sipariş tutarı ve ürün listesi)</li>
  </ul>

  <h2>2. Kullanılmayan Veriler</h2>
  <p>Shoptimize Live, müşterilerin adı, e-posta adresi, telefon numarası veya ödeme bilgilerini <strong>toplamaz ve saklamaz</strong>. Tüm ziyaretçi izleme anonim kimlikler üzerinden yapılır.</p>

  <h2>3. Verilerin Kullanımı</h2>
  <p>Toplanan veriler yalnızca mağaza sahibine gerçek zamanlı aktivite göstermek amacıyla kullanılır. Üçüncü taraflarla paylaşılmaz veya reklam amaçlı kullanılmaz.</p>

  <h2>4. Veri Saklama</h2>
  <p>Etkinlik verileri en fazla 7 gün süreyle saklanır, ardından otomatik olarak silinir. Uygulama kaldırıldığında tüm veriler 48 saat içinde silinir.</p>

  <h2>5. GDPR ve Veri Silme</h2>
  <p>Shopify'ın GDPR gereksinimlerine tam uyum sağlanmaktadır. Müşteri ve mağaza veri silme talepleri otomatik olarak işlenir.</p>

  <h2>6. İletişim</h2>
  <p>Gizlilik politikamız hakkında sorularınız için:
  <a href="mailto:koray@korayyildiz.com.tr">koray@korayyildiz.com.tr</a></p>
</body>
</html>"""


# Serve frontend (production build) — must be last
_frontend_dist = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
