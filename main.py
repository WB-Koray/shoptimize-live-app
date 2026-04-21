"""
shoptimize-live-app — Bağımsız Live Activity servisi.
Mevcut shoptimize backend'e dokunmadan çalışır.

Port: 8001 (Coolify'da ayarlanacak)
"""

import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
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


# Serve frontend (production build) — must be last
_frontend_dist = os.path.join(os.path.dirname(__file__), "frontend", "dist")
if os.path.isdir(_frontend_dist):
    app.mount("/", StaticFiles(directory=_frontend_dist, html=True), name="frontend")
