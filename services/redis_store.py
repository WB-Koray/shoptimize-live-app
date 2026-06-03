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

    async def check_rate_limit(self, key: str, limit: int, window_sec: int = 60) -> bool:
        """Sabit pencere rate limiter. Limit aşıldıysa True döner."""
        count = await self._redis.incr(key)
        if count == 1:
            await self._redis.expire(key, window_sec)
        return count > limit

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
        brand = brand or "default"
        await self._redis.hset(f"tid_owner:{tid}", mapping={
            "username": username or "",
            "brand": brand,
        })
        if username:
            await self._redis.set(f"user_tid:{username}:{brand}", tid)

    async def get_user_tid(self, username: str, brand: str = "default") -> str:
        val = await self._redis.get(f"user_tid:{username}:{brand}")
        return val or ""

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

    _CHECKOUT_TTL = 259_200  # 72 saat (sequence adımları için yeterli)

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

    async def add_optout(self, phone: str, username: str = "", brand: str = "default") -> None:
        normalized = phone.strip().lstrip("+")
        if username:
            await self._redis.setex(f"optout:{username}:{brand}:{normalized}", self._OPTOUT_TTL, "1")
        else:
            # legacy global key (geriye dönük uyumluluk)
            await self._redis.setex(f"optout:{normalized}", self._OPTOUT_TTL, "1")

    async def is_optout(self, phone: str, username: str = "", brand: str = "default") -> bool:
        normalized = phone.strip().lstrip("+")
        if username:
            if await self._redis.exists(f"optout:{username}:{brand}:{normalized}"):
                return True
        # Legacy global key fallback
        return bool(await self._redis.exists(f"optout:{normalized}"))

    async def remove_optout(self, phone: str, username: str = "", brand: str = "default") -> None:
        normalized = phone.strip().lstrip("+")
        if username:
            await self._redis.delete(f"optout:{username}:{brand}:{normalized}")
        await self._redis.delete(f"optout:{normalized}")

    async def get_all_optouts(self, username: str = "", brand: str = "default") -> list[str]:
        seen = set()
        if username:
            # Sadece bu merchant'a ait yeni format key'ler: optout:{username}:{brand}:{phone}
            prefix = f"optout:{username}:{brand}:"
            async for key in self._redis.scan_iter(f"{prefix}*"):
                phone = key.split(prefix, 1)[1]
                if phone:
                    seen.add("+" + phone)
        else:
            # username verilmemişse sadece legacy format göster
            async for key in self._redis.scan_iter("optout:*"):
                parts = key.split(":")
                if len(parts) == 2 and parts[1]:
                    seen.add("+" + parts[1])
        return sorted(seen)

    async def find_optout_owner(self, phone: str) -> tuple[str, str] | None:
        """Telefon numarasına ait opt-out kaydının (username, brand) bilgisini döner."""
        normalized = phone.strip().lstrip("+")
        async for key in self._redis.scan_iter(f"optout:*:{normalized}"):
            parts = key.split(":")
            if len(parts) == 4:  # optout:username:brand:phone
                return parts[1], parts[2]
        return None

    async def set_merchant_phone_id(self, phone_number_id: str, username: str, brand: str) -> None:
        """WA phone_number_id → merchant eşlemesini kaydeder (opt-out routing için)."""
        await self._redis.set(f"wa_phone_id:{phone_number_id}", f"{username}:{brand}")

    async def find_merchant_by_phone_id(self, phone_number_id: str) -> tuple[str, str] | None:
        """WA phone_number_id'den (username, brand) döner."""
        val = await self._redis.get(f"wa_phone_id:{phone_number_id}")
        if val:
            parts = val.split(":", 1)
            if len(parts) == 2:
                return parts[0], parts[1]
        return None

    # ── Telefon bazlı aktif sequence takibi (cooldown dedup) ────────────────────

    async def get_phone_active_token(self, phone: str) -> str | None:
        """Bu telefon için aktif sequence token'ını döner; yoksa None."""
        normalized = phone.strip().lstrip("+")
        return await self._redis.get(f"wa_phone_active:{normalized}")

    async def set_phone_active_token(self, phone: str, checkout_token: str, ttl_hours: int = 48) -> None:
        """Telefon için aktif sequence token'ını kaydeder. TTL = cooldown süresi."""
        normalized = phone.strip().lstrip("+")
        await self._redis.setex(f"wa_phone_active:{normalized}", int(ttl_hours * 3600), checkout_token)

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

    async def delete_flow_data(self, username: str, brand: str) -> None:
        """
        GDPR / app/uninstalled: merchant'a ait WA flow verisini sil.
        - flow_logs:{username}:{brand}   — gönderim geçmişi
        - wa_orders:{username}:{brand}   — WA atıflı siparişler
        Not: wa_step:* ve wa_phone_active:* key'leri token/telefon bazlıdır ve
        kısa TTL ile zaten sona erer; merchant bazlı tarama yapılamaz.
        """
        pipe = self._redis.pipeline()
        pipe.delete(f"flow_logs:{username}:{brand}")
        pipe.delete(f"wa_orders:{username}:{brand}")
        await pipe.execute()

    # ── WA dönüşüm sipariş detayları ────────────────────────────────────────────

    async def save_converted_order(self, username: str, brand: str, order_data: dict) -> None:
        key = f"wa_orders:{username}:{brand}"
        pipe = self._redis.pipeline()
        pipe.lpush(key, json.dumps(order_data, ensure_ascii=False))
        pipe.ltrim(key, 0, 199)
        pipe.expire(key, 86400 * 30)
        await pipe.execute()

    async def get_converted_orders(self, username: str, brand: str, limit: int = 50) -> list[dict]:
        raws = await self._redis.lrange(f"wa_orders:{username}:{brand}", 0, min(limit, 200) - 1)
        result = []
        for r in raws:
            try:
                result.append(json.loads(r))
            except Exception:
                pass
        return result

    async def get_wa_roi_stats(self, username: str, brand: str, days: int = 7) -> dict:
        """WA attribution ROI istatistiklerini döner: son N günde WA'dan gelen siparişler ve ciro."""
        import time as _time
        all_orders = await self.get_converted_orders(username, brand, limit=200)
        cutoff_ms = (_time.time() - days * 86400) * 1000
        recent_orders = [o for o in all_orders if o.get("ts", 0) >= cutoff_ms]
        wa_orders = [o for o in recent_orders if o.get("wa_attributed")]
        total_wa_revenue = sum(float(o.get("total_price", 0) or 0) for o in wa_orders)
        total_revenue = sum(float(o.get("total_price", 0) or 0) for o in recent_orders)
        currency = wa_orders[0]["currency"] if wa_orders else (recent_orders[0]["currency"] if recent_orders else "TRY")
        return {
            "days": days,
            "total_orders": len(recent_orders),
            "wa_attributed_count": len(wa_orders),
            "total_revenue": round(total_revenue, 2),
            "wa_revenue": round(total_wa_revenue, 2),
            "currency": currency,
            "wa_orders": wa_orders[:10],
        }

    # ── GDPR / cleanup ──────────────────────────────────────────────────────────

    async def delete_tid_events(self, tid: str) -> None:
        """GDPR shop/redact: TID'e ait tüm event ve visitor key'lerini sil."""
        pipe = self._redis.pipeline()
        pipe.delete(f"events:{tid}")
        pipe.delete(f"tid_owner:{tid}")
        await pipe.execute()
        async for key in self._redis.scan_iter(f"visitor:{tid}:*"):
            await self._redis.delete(key)

    # ── Mağaza sahibi telefon → username eşleşmesi ──────────────────────────────

    async def set_owner_phone(self, username: str, brand: str, phone: str) -> None:
        """Mağaza sahibi telefonu → username:brand eşleşmesini kaydeder (1 yıl TTL)."""
        normalized = phone.strip().lstrip("+")
        if not normalized:
            return
        await self._redis.set(f"owner_phone:{normalized}", f"{username}:{brand}", ex=86400 * 365)
        logger.info("[REDIS] Sahip telefonu kaydedildi: %s → %s:%s", normalized[-4:], username, brand)

    async def get_username_by_phone(self, phone: str) -> Optional[tuple[str, str]]:
        """Telefon numarasına göre (username, brand) döner; bulunamazsa None."""
        normalized = phone.strip().lstrip("+")
        val = await self._redis.get(f"owner_phone:{normalized}")
        if not val:
            return None
        parts = val.split(":", 1)
        if len(parts) == 2:
            return parts[0], parts[1]
        return parts[0], "default"

    async def warmup_tid_cache(self):
        import re as _re
        count = 0
        try:
            from services.db import get_all_shopify_connections, set_connection_settings as _scs, get_setting as _gs
            connections = get_all_shopify_connections()
            for item in connections:
                tid = (item["connection"].get("settings") or {}).get("pixel_tracking_id", "")
                if tid:
                    await self.register_tid_owner(tid, item["username"], item["brand"])
                    count += 1
        except Exception as e:
            logger.error("[REDIS] Warmup (DB) hatası: %s", e)

        # Redis-based recovery: scan active events:{tid} keys, parse old-format TIDs
        try:
            recovered = 0
            async for key in self._redis.scan_iter("events:*"):
                tid = key[7:] if isinstance(key, str) else key.decode()[7:]
                if tid.startswith("spt_"):
                    continue
                if await self._redis.exists(f"tid_owner:{tid}"):
                    continue
                parts = tid.rsplit("_", 2)
                if len(parts) == 3 and _re.fullmatch(r"[0-9a-f]{8,32}", parts[2]):
                    u, b = parts[0], parts[1]
                    await self.register_tid_owner(tid, u, b)
                    recovered += 1
                    # Persist to DB so future warmups find it too
                    try:
                        from services.db import get_setting as _gs, set_connection_settings as _scs
                        if not _gs(u, b, "shopify", "pixel_tracking_id", ""):
                            _scs(u, b, "shopify", {"pixel_tracking_id": tid})
                    except Exception:
                        pass
            if recovered:
                logger.info("[REDIS] TID warmup (Redis recovery): %d kayıt kurtarıldı", recovered)
        except Exception as e:
            logger.error("[REDIS] Warmup (Redis scan) hatası: %s", e)

        logger.info("[REDIS] TID warmup tamamlandı: DB=%d", count)


store = RedisStore()
