"""
shoptimize-live-app — Bağımsız Live Activity servisi.
Mevcut shoptimize backend'e dokunmadan çalışır.

Port: 8001 (Coolify'da ayarlanacak)
"""

from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from services.redis_store import store
from routers import live


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


@app.get("/health")
async def health():
    return {"ok": True, "service": "shoptimize-live"}
