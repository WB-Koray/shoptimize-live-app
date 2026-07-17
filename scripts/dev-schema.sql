-- Yerel geliştirme şeması — production'da bu tablo ana shoptimize backend'ine ait
-- ve paylaşılır (bkz. README "Servisler / services/db.py").
-- Burada yalnız shoptimize-live-app'in okuduğu/güncellediği alanlar var.
--
-- Kolonlar services/db.py'deki sorgulardan türetildi:
--   get_setting              → username, brand, integration_id, payload_json
--   set_connection_settings  → + updated_at (EXTRACT(EPOCH FROM NOW())::bigint)
--   lookup_username_by_shop  → payload_json içinde shop_domain arar
--   get_all_shopify_connections → integration_id = 'shopify' olanları döner

CREATE TABLE IF NOT EXISTS integration_connections (
    id             SERIAL PRIMARY KEY,
    username       TEXT NOT NULL,
    brand          TEXT NOT NULL DEFAULT 'default',
    integration_id TEXT NOT NULL,
    payload_json   JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at     BIGINT NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::bigint,
    UNIQUE (username, brand, integration_id)
);

CREATE INDEX IF NOT EXISTS idx_integration_connections_lookup
    ON integration_connections (integration_id, username, brand);

-- ── Yerel test merchant'ı ───────────────────────────────────────────────────
-- pixel_tracking_id: /api/campaign/list ve pixel event'leri bu TID'i kullanır.
-- shop_domain / admin_api_token: GERÇEK Shopify sorguları için gerekir (stok
-- widget'ı, RFM). Boş bırakıldı — gerçek mağazaya sorgu atmak isterseniz
-- kendi token'ınızı buraya yazın. Boşken Shopify'a giden endpoint'ler
-- "shopify_not_connected" döner, Redis tabanlı özellikler etkilenmez.
INSERT INTO integration_connections (username, brand, integration_id, payload_json)
VALUES (
    'dev@localhost',
    'default',
    'shopify',
    jsonb_build_object(
        'settings', jsonb_build_object(
            'pixel_tracking_id', 'spt_devtest0001',
            'shop_domain',       '',
            'admin_api_token',   '',
            'billing_status',    'active',
            'installed_at',      EXTRACT(EPOCH FROM NOW())::bigint
        )
    )
)
ON CONFLICT (username, brand, integration_id) DO NOTHING;
