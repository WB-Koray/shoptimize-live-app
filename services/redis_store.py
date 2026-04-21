"""
Redis katmanı — tüm live activity state'ini Redis'te tutar.
"""

import asyncio
import json
import logging
import os
from typing import Optional

import redis.asyncio as aioredis

logger = logging.getLogger(__name__)

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")

_MAX_EVENTS = 5000
_VISITOR_TTL = 600       # 10 dakika
_EVENTS_TTL  = 86400 * 7  # 7 gün


class RedisStore:
    def __init__(self):
        self._redis: Optional[aioredis.Redis] = None
        self._queues: dict[str, list[asyncio.Queue]] = {}
        self._pubsub_task: Optional[asyncio.Task] = None

    async def connect(self):
        self._redis = aioredis.from_url(
            REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
            health_check_interval=30,
        )
        try:
            await self._redis.ping()
            logger.info("[REDIS] Bağlantı başarılı: %s", REDIS_URL.split("@")[-1])
        except Exception as e:
            logger.error("[REDIS] Bağlantı hatası: %s", e)
            raise

        self._pubsub_task = asyncio.create_task(self._pubsub_listener())

    async def disconnect(self):
        if self._pubsub_task:
            self._pubsub_task.cancel()
        if self._redis:
            await self._redis.aclose()

    async def push_event(self, tid: str, event: dict) -> None:
        raw = json.dumps(event, ensure_ascii=False)
        key = f"events:{tid}"
        pipe = self._redis.pipeline()
        pipe.lpush(key, raw)
        pipe.ltrim(key, 0, _MAX_EVENTS - 1)
        pipe.expire(key, _EVENTS_TTL)
        await pipe.execute()

        vid = event.get("vid", "")
        if vid:
            await self._redis.setex(f"visitor:{tid}:{vid}", _VISITOR_TTL, "1")

        await self._redis.publish(f"live:{tid}", raw)

    async def get_recent_events(self, tid: str, limit: int = 200) -> list[dict]:
        limit = min(limit, _MAX_EVENTS)
        raws = await self._redis.lrange(f"events:{tid}", 0, limit - 1)
        events = []
        for r in raws:
            try:
                events.append(json.loads(r))
            except Exception:
                pass
        return events

    async def count_events(self, tid: str) -> int:
        return await self._redis.llen(f"events:{tid}")

    async def get_active_visitor_count(self, tid: str) -> int:
        count = 0
        async for _ in self._redis.scan_iter(f"visitor:{tid}:*"):
            count += 1
        return count

    async def register_tid_owner(self, tid: str, username: str, brand: str) -> None:
        if not tid:
            return
        await self._redis.hset(f"tid_owner:{tid}", mapping={
            "username": username or "",
            "brand": brand or "default",
        })

    async def get_tid_owner(self, tid: str) -> Optional[tuple[str, str]]:
        data = await self._redis.hgetall(f"tid_owner:{tid}")
        if data:
            return data.get("username", ""), data.get("brand", "default")
        return None

    def subscribe(self, tid: str) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=100)
        self._queues.setdefault(tid, []).append(q)
        return q

    def unsubscribe(self, tid: str, q: asyncio.Queue) -> None:
        if tid in self._queues:
            try:
                self._queues[tid].remove(q)
            except ValueError:
                pass

    async def _pubsub_listener(self):
        pubsub = self._redis.pubsub()
        await pubsub.psubscribe("live:*")
        logger.info("[REDIS] Pub/Sub dinleyici başlatıldı")
        try:
            async for message in pubsub.listen():
                if message["type"] != "pmessage":
                    continue
                channel: str = message["channel"]
                tid = channel[5:]
                raw = message["data"]
                try:
                    event = json.loads(raw)
                except Exception:
                    continue
                for q in list(self._queues.get(tid, [])):
                    try:
                        q.put_nowait(event)
                    except asyncio.QueueFull:
                        pass
        except asyncio.CancelledError:
            pass
        except Exception as e:
            logger.error("[REDIS] Pub/Sub hatası: %s", e)
        finally:
            await pubsub.aclose()

    async def warmup_tid_cache(self):
        try:
            from services.db import get_all_shopify_connections
            connections = get_all_shopify_connections()
            count = 0
            for item in connections:
                tid = (item["connection"].get("settings") or {}).get("pixel_tracking_id", "")
                if tid:
                    await self.register_tid_owner(tid, item["username"], item["brand"])
                    count += 1
            logger.info("[REDIS] TID warmup: %d kayıt", count)
        except Exception as e:
            logger.error("[REDIS] Warmup hatası: %s", e)


store = RedisStore()
