"""
PostgreSQL bağlantısı — TID ve webhook token okuma için.
Mevcut shoptimize backend ile aynı DB'yi paylaşır, sadece okur.
"""

import os
import json
import logging
from contextlib import contextmanager
import psycopg2
import psycopg2.extras
from typing import Optional

logger = logging.getLogger(__name__)

DSN = os.getenv(
    "INTEGRATIONS_POSTGRES_DSN",
    os.getenv("DATABASE_URL", "")
)


@contextmanager
def _get_conn():
    """Postgres baglantisi — transaction'i kapatir VE baglantiyi kapatir.

    Onceki hali duz `psycopg2.connect(DSN)` donuyordu ve cagiranlar
    `with _get_conn() as conn:` kullaniyordu. psycopg2'de connection context
    manager'i transaction'i yonetir, BAGLANTIYI KAPATMAZ — yaygin bir tuzak.
    Baglantilar cop toplayiciya kaliyor, yuk altinda birikiyor ve Postgres
    max_connections sinirina dayaninca yeni baglantilar reddediliyordu.

    Sonucu sessizdi: get_setting / lookup_username_by_shop hatayi yutup
    varsayilani donuyor, uygulama da bunu "ayar yok" sanip yanlis karar
    veriyordu (sonsuz kurulum donguusu, kopya webhook token'i, "Shopify
    baglantisi bulunamadi").
    """
    conn = psycopg2.connect(DSN, connect_timeout=10)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def get_setting_strict(username: str, brand: str, integration: str, key: str, default=""):
    """get_setting'in hata yutmayan hali — DB erisimi basarisizsa firlatir.

    get_setting DB hatasinda varsayilani doner. Cogu cagri icin zararsiz, ama
    "deger yoksa yenisini uret" kalibinda olumcul: okuma basarisiz oldugu icin
    bos donen bir degeri "hic yok" sanip yenisini uretmek Shopify webhook
    aboneliklerinin cogalmasina yol acti (her yeni token yeni URL, yeni
    abonelik; eskiler de duruyor). Boyle yerlerde bu surum kullanilmali.
    """
    with _get_conn() as conn:
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(
                """
                SELECT payload_json FROM integration_connections
                WHERE username = %s AND brand = %s AND integration_id = %s
                LIMIT 1
                """,
                (username, brand, integration),
            )
            row = cur.fetchone()
            if row and row["payload_json"]:
                data = row["payload_json"]
                if isinstance(data, str):
                    data = json.loads(data)
                sub = data.get("settings", {})
                val = sub.get(key) if isinstance(sub, dict) else None
                if val is None:
                    val = data.get(key)
                return val if val is not None else default
    return default


def get_setting(username: str, brand: str, integration: str, key: str, default=""):
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT payload_json FROM integration_connections
                    WHERE username = %s AND brand = %s AND integration_id = %s
                    LIMIT 1
                    """,
                    (username, brand, integration),
                )
                row = cur.fetchone()
                if row and row["payload_json"]:
                    data = row["payload_json"]
                    if isinstance(data, str):
                        data = json.loads(data)
                    # settings alt anahtarı varsa orada ara, yoksa kök seviyede
                    sub = data.get("settings", {})
                    val = sub.get(key) if isinstance(sub, dict) else None
                    if val is None:
                        val = data.get(key)
                    return val if val is not None else default
    except Exception as e:
        logger.error("[DB] get_setting hatası: %s", e)
    return default


def set_connection_settings(username: str, brand: str, integration: str, updates: dict):
    """
    integration_connections tablosundaki payload_json alanını günceller.
    """
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT payload_json FROM integration_connections
                    WHERE username = %s AND brand = %s AND integration_id = %s
                    LIMIT 1
                    """,
                    (username, brand, integration),
                )
                row = cur.fetchone()
                if row:
                    existing = row["payload_json"] or {}
                    if isinstance(existing, str):
                        existing = json.loads(existing)
                    existing.update(updates)
                    cur.execute(
                        """
                        UPDATE integration_connections SET payload_json = %s, updated_at = EXTRACT(EPOCH FROM NOW())::bigint
                        WHERE username = %s AND brand = %s AND integration_id = %s
                        """,
                        (json.dumps(existing), username, brand, integration),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO integration_connections (username, brand, integration_id, payload_json, updated_at)
                        VALUES (%s, %s, %s, %s, EXTRACT(EPOCH FROM NOW())::bigint)
                        """,
                        (username, brand, integration, json.dumps(updates)),
                    )
            conn.commit()
    except Exception as e:
        logger.error("[DB] set_connection_settings hatası: %s", e)


class ShopLookupError(Exception):
    """Magaza aramasi teknik bir sebeple yapilamadi (DB erisimi vb.).

    "Bulunamadi" (None) ile ayni sey DEGIL: biri tekrar denemeyi, digeri
    kurulum akisini baslatmayi gerektirir.
    """


def lookup_username_by_shop(shop_domain: str) -> tuple[str, str] | None:
    """
    shop_domain'e göre (username, brand) döner.
    Örn: '59fc15-cd.myshopify.com' → ('koray@korayyildiz.com.tr', 'default')
    Bulunamazsa None döner.
    """
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT username, brand, payload_json FROM integration_connections
                    WHERE integration_id = 'shopify'
                    """,
                )
                rows = cur.fetchall()
                for row in rows:
                    # Satir basina koruma: TEK bir merchant'in bozuk payload'i
                    # (gecersiz JSON, dict yerine liste, beklenmedik tip) tum
                    # taramayi cokertiyordu — yani bir kaydin bozulmasi BUTUN
                    # magazalarin girisini kiriyordu. Bozuk satir atlanir,
                    # hangi kayit oldugu loglanir; arama devam eder.
                    try:
                        data = row["payload_json"] or {}
                        if isinstance(data, str):
                            data = json.loads(data)
                        if not isinstance(data, dict):
                            raise TypeError(f"payload_json dict degil: {type(data).__name__}")
                        sub = data.get("settings")
                        stored = (sub.get("shop_domain") if isinstance(sub, dict) else None)                                  or data.get("shop_domain", "")
                        if not isinstance(stored, str):
                            stored = ""
                    except Exception as _row_err:
                        logger.warning(
                            "[DB] bozuk kayit atlandi: username=%s brand=%s — %s",
                            row.get("username"), row.get("brand"), _row_err,
                        )
                        continue
                    if stored and stored.lower() == shop_domain.lower():
                        return (row["username"], row["brand"])
    except Exception as e:
        # DB hatasini "magaza kurulu degil" ile ayni cevaba (None) indirgemek
        # cagiranlari yaniltiyordu: embedded app 404 gorup OAuth kurulumuna
        # yonlendiriyor, OAuth admin'e geri donuyor, uygulama tekrar aciliyor
        # ve gecici bir DB hatasi sonsuz yonlendirme donguusune donusuyordu.
        # Artik ayirt edilebilir: cagiran kendi baglamina gore karar versin.
        logger.error("[DB] lookup_username_by_shop hatası: %s", e)
        raise ShopLookupError(str(e)) from e
    return None


def get_all_shopify_connections():
    """
    Tüm Shopify bağlantılarını döner — TID warmup için.
    """
    try:
        with _get_conn() as conn:
            with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
                cur.execute(
                    """
                    SELECT username, brand, payload_json FROM integration_connections
                    WHERE integration_id = 'shopify'
                    """
                )
                rows = cur.fetchall()
                result = []
                for row in rows:
                    settings = row["payload_json"] or {}
                    if isinstance(settings, str):
                        settings = json.loads(settings)
                    result.append({
                        "username": row["username"],
                        "brand": row["brand"],
                        "connection": {"settings": settings},
                    })
                return result
    except Exception as e:
        logger.error("[DB] get_all_shopify_connections hatası: %s", e)
        return []
