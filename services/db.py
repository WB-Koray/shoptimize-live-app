"""
PostgreSQL bağlantısı — TID ve webhook token okuma için.
Mevcut shoptimize backend ile aynı DB'yi paylaşır, sadece okur.
"""

import os
import json
import logging
import psycopg2
import psycopg2.extras
from typing import Optional

logger = logging.getLogger(__name__)

DSN = os.getenv(
    "INTEGRATIONS_POSTGRES_DSN",
    os.getenv("DATABASE_URL", "")
)


def _get_conn():
    return psycopg2.connect(DSN)


def get_setting(username: str, brand: str, integration: str, key: str, default=""):
    """
    integration_connections tablosundan ayar okur.
    Sütunlar: username, brand, integration_id, payload_json, updated_at
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
                if row and row["payload_json"]:
                    settings = row["payload_json"]
                    if isinstance(settings, str):
                        settings = json.loads(settings)
                    return settings.get(key, default)
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
                        UPDATE integration_connections SET payload_json = %s, updated_at = NOW()
                        WHERE username = %s AND brand = %s AND integration_id = %s
                        """,
                        (json.dumps(existing), username, brand, integration),
                    )
                else:
                    cur.execute(
                        """
                        INSERT INTO integration_connections (username, brand, integration_id, payload_json, updated_at)
                        VALUES (%s, %s, %s, %s, NOW())
                        """,
                        (username, brand, integration, json.dumps(updates)),
                    )
            conn.commit()
    except Exception as e:
        logger.error("[DB] set_connection_settings hatası: %s", e)


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
