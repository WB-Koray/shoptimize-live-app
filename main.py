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
            # Türkiye saati kontrolü (UTC+3, DST yok)
            tr_hour = (datetime.datetime.utcnow().hour + 3) % 24
            if tr_hour < 9 or tr_hour >= 21:
                continue  # 09:00–21:00 dışında gönderme

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
                wa_token = settings.get("wa_token", "")
                phone_id = settings.get("phone_number_id", "")
                phone    = co.get("phone", "")
                if not wa_token or not phone_id or not phone:
                    continue

                # Sequence: [{delay_minutes, template, enabled, label}, ...]
                sequence = settings.get("sequence") or [{
                    "delay_minutes": settings.get("delay_minutes", 15),
                    "template": "sepet_hatirlatma",
                    "enabled": True,
                    "label": "İlk hatırlatma",
                }]

                checkout_ts = co.get("ts", 0)
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
                        template_name=tmpl, language=lang,
                    )
                    await store.mark_step_sent(token, step_idx)

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


@app.get("/health")
async def health():
    return {"ok": True, "service": "shoptimize-live"}


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
