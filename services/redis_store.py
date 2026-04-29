"""
Redis katmanı — tüm live activity state'ini Redis'te tutar.
"""

import asyncio
import hashlib
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

    async def is_duplicate(self, tid: str, vid: str, event_type: str, url: str, window_sec: int = 10) -> bool:
        url_hash = hashlib.md5(url.encode()).hexdigest()[:12]
        key = f"dedup:{tid}:{vid}:{event_type}:{url_hash}"
        result = await self._redis.set(key, "1", ex=window_sec, nx=True)
        return result is None

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
        raws = await self._redis.lrange(f"events:{tid}", 0, _MAX_EVENTS - 1)
        events = []
        seen: set[str] = set()
        for r in raws:
            try:
                ev = json.loads(r)
                bucket = ev.get("ts", 0) // 10_000
                key = f"{ev.get('vid','')}:{ev.get('event_type','')}:{ev.get('url','')}:{bucket}"
                if key in seen:
                    continue
                seen.add(key)
                events.append(ev)
                if len(events) >= limit:
                    break
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

    # ── Checkout takibi (terk edilmiş ödeme akışı) ──────────────────────────────

    _CHECKOUT_TTL = 14_400  # 4 saat

    async def save_checkout(self, checkout_token: str, data: dict) -> None:
        """Checkout webhook'undan gelen veriyi Redis'e yazar."""
        await self._redis.setex(
            f"checkout:{checkout_token}",
            self._CHECKOUT_TTL,
            json.dumps(data, ensure_ascii=False),
        )
        # Zaman damgasıyla global sıralı set'e ekle
        await self._redis.zadd("pending_checkouts", {checkout_token: data.get("ts", 0)})

    async def mark_checkout_completed(self, checkout_token: str) -> None:
        await self._redis.setex(f"checkout_done:{checkout_token}", self._CHECKOUT_TTL, "1")
        await self._redis.zrem("pending_checkouts", checkout_token)

    async def is_checkout_completed(self, checkout_token: str) -> bool:
        return bool(await self._redis.exists(f"checkout_done:{checkout_token}"))

    async def get_checkout(self, checkout_token: str) -> dict | None:
        raw = await self._redis.get(f"checkout:{checkout_token}")
        if not raw:
            return None
        try:
            return json.loads(raw)
        except Exception:
            return None

    async def get_pending_checkouts_before(self, cutoff_ms: int) -> list[str]:
        """cutoff_ms öncesindeki tüm checkout token'larını döner."""
        return await self._redis.zrangebyscore("pending_checkouts", 0, cutoff_ms)

    async def remove_pending_checkout(self, checkout_token: str) -> None:
        await self._redis.zrem("pending_checkouts", checkout_token)

    async def is_wa_sent(self, checkout_token: str) -> bool:
        return bool(await self._redis.exists(f"wa_sent:{checkout_token}"))

    async def mark_wa_sent(self, checkout_token: str) -> None:
        await self._redis.setex(f"wa_sent:{checkout_token}", self._CHECKOUT_TTL, "1")

    async def is_step_sent(self, checkout_token: str, step_idx: int) -> bool:
        if step_idx == 0 and await self._redis.exists(f"wa_sent:{checkout_token}"):
            return True
        return bool(await self._redis.exists(f"wa_step:{checkout_token}:{step_idx}"))

    async def mark_step_sent(self, checkout_token: str, step_idx: int) -> None:
        await self._redis.setex(f"wa_step:{checkout_token}:{step_idx}", self._CHECKOUT_TTL, "1")
        if step_idx == 0:
            await self._redis.setex(f"wa_sent:{checkout_token}", self._CHECKOUT_TTL, "1")

    # ── Opt-out yönetimi ────────────────────────────────────────────────────────

    _OPTOUT_TTL = 86400 * 365  # 1 yıl

    async def add_optout(self, phone: str) -> None:
        normalized = phone.strip().lstrip("+")
        await self._redis.setex(f"optout:{normalized}", self._OPTOUT_TTL, "1")

    async def is_optout(self, phone: str) -> bool:
        normalized = phone.strip().lstrip("+")
        return bool(await self._redis.exists(f"optout:{normalized}"))

    async def remove_optout(self, phone: str) -> None:
        normalized = phone.strip().lstrip("+")
        await self._redis.delete(f"optout:{normalized}")

    async def get_all_optouts(self) -> list[str]:
        result = []
        async for key in self._redis.scan_iter("optout:*"):
            result.append("+" + key.split("optout:", 1)[1])
        return sorted(result)

    # ── Dönüşüm takibi ──────────────────────────────────────────────────────────

    async def mark_flow_converted(self, username: str, brand: str, checkout_token: str) -> None:
        key = f"flow_converted:{username}:{brand}"
        await self._redis.sadd(key, checkout_token)
        await self._redis.expire(key, 86400 * 30)

    async def get_converted_tokens(self, username: str, brand: str) -> set:
        members = await self._redis.smembers(f"flow_converted:{username}:{brand}")
        return {m.decode() if isinstance(m, bytes) else m for m in members}

    # ── Flow ayarları ────────────────────────────────────────────────────────────

    async def save_flow_settings(self, username: str, brand: str, settings: dict) -> None:
        await self._redis.set(
            f"flow_settings:{username}:{brand}",
            json.dumps(settings, ensure_ascii=False),
        )

    async def get_flow_settings(self, username: str, brand: str) -> dict:
        raw = await self._redis.get(f"flow_settings:{username}:{brand}")
        if not raw:
            return {}
        try:
            return json.loads(raw)
        except Exception:
            return {}

    async def append_flow_log(self, username: str, brand: str, entry: dict) -> None:
        key = f"flow_logs:{username}:{brand}"
        pipe = self._redis.pipeline()
        pipe.lpush(key, json.dumps(entry, ensure_ascii=False))
        pipe.ltrim(key, 0, 199)
        await pipe.execute()

    async def get_flow_logs(self, username: str, brand: str, limit: int = 50) -> list[dict]:
        raws = await self._redis.lrange(f"flow_logs:{username}:{brand}", 0, min(limit, 200) - 1)
        result = []
        for r in raws:
            try:
                result.append(json.loads(r))
            except Exception:
                pass
        return result

    async def clear_flow_logs(self, username: str, brand: str) -> None:
        await self._redis.delete(f"flow_logs:{username}:{brand}")

    # ── GDPR / cleanup ──────────────────────────────────────────────────────────

    async def delete_tid_events(self, tid: str) -> None:
        """GDPR shop/redact: TID'e ait tüm event ve visitor key'lerini sil."""
        pipe = self._redis.pipeline()
        pipe.delete(f"events:{tid}")
        pipe.delete(f"tid_owner:{tid}")
        await pipe.execute()
        async for key in self._redis.scan_iter(f"visitor:{tid}:*"):
            await self._redis.delete(key)

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
