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


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    await store.connect()
    await store.warmup_tid_cache()
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
