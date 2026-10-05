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
                data = payload_coz(row["payload_json"])
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
                    data = payload_coz(row["payload_json"])
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
                    ham = row["payload_json"]
                    # Kaydin mevcut formati korunur: sifreli gelen sifreli
                    # yazilir. Aksi halde ana backend o kaydi bir daha
                    # okuyamaz — bu tabloyu o yaziyor, biz paylasiyoruz.
                    sifreli = payload_sifreli_mi(ham)
                    existing = payload_coz(ham)
                    existing.update(updates)
                    cur.execute(
                        """
                        UPDATE integration_connections SET payload_json = %s, updated_at = EXTRACT(EPOCH FROM NOW())::bigint
                        WHERE username = %s AND brand = %s AND integration_id = %s
                        """,
                        (payload_yaz(existing, sifreli), username, brand, integration),
                    )
                else:
                    # Yeni kayit: anahtar varsa ana backend'le ayni formatta
                    # (sifreli) yaz; yoksa duz JSON.
                    cur.execute(
                        """
                        INSERT INTO integration_connections (username, brand, integration_id, payload_json, updated_at)
                        VALUES (%s, %s, %s, %s, EXTRACT(EPOCH FROM NOW())::bigint)
                        """,
                        (username, brand, integration, payload_yaz(updates, bool(_ENC_KEY))),
                    )
            conn.commit()
    except Exception as e:
        logger.error("[DB] set_connection_settings hatası: %s", e)


def _kayit_oncelik(username: str, data: dict, shop_domain: str):
    """Ayni shop_domain'e sahip kayitlar arasinda hangisi gercek hesap?

    Arama bozuldugunda cagiran taraf shop adindan username turetip yeni bir
    kayit aciyordu (auth.py _shop_to_username: 59fc15-cd.myshopify.com ->
    59fc15-cd). Boylece ayni magaza icin iki kayit olustu ve magaza bos olana
    giriyordu. Burada gercek hesap tercih edilir:

      1. Turetilmis olmayan username once gelir
      2. Esitlikte, dolu alan sayisi fazla olan kazanir

    Kolon adina (id, created_at) guvenilmiyor: bu tablo ana backend'e ait ve
    semasi bu repodan dogrulanamiyor.
    """
    turetilmis = username.strip().lower() == shop_domain.replace(".myshopify.com", "").strip().lower()
    ayarlar = data.get("settings") if isinstance(data.get("settings"), dict) else {}
    dolu = sum(
        1 for k in ("admin_api_token", "pixel_tracking_id", "webhook_token",
                    "wa_token", "phone_number_id", "billing_status")
        if (ayarlar.get(k) or data.get(k))
    )
    return (0 if turetilmis else 1, dolu)


# ── payload_json sifrelemesi ────────────────────────────────────────────────
# Ana backend (shoptimize-backend) bu tabloyu "enc1:" + Fernet ile sifreli
# yaziyor. Bu uygulama formati tanimadigi icin 18 kayittan 17'sini hic
# okuyamiyordu; okuyabildigi tek kayit kendi yazdigi duz JSON olandi. Sonucu
# agirdi: magaza aramasi hicbir kaydi bulamiyor, cagiran taraf shop adindan
# username turetip yeni bos kayit aciyor ve magaza kendi verilerini kaybetmis
# saniyordu.
#
# Yazarken kaydin MEVCUT formati korunur: sifreli gelen sifreli yazilir, yoksa
# ana backend o kaydi bir daha okuyamaz.
_ENC_ONEK = "enc1:"
_ENC_KEY = os.getenv("DATA_ENCRYPTION_KEY", "").strip()


class PayloadDecryptError(Exception):
    """Sifreli payload cozulemedi — anahtar eksik ya da yanlis."""


def _fernet():
    from cryptography.fernet import Fernet
    if not _ENC_KEY:
        raise PayloadDecryptError("DATA_ENCRYPTION_KEY tanimli degil")
    return Fernet(_ENC_KEY.encode())


def payload_coz(ham):
    """Saklanan payload_json degerini dict'e cevirir (sifreliyse cozer)."""
    if ham is None:
        return {}
    if isinstance(ham, dict):
        return ham
    metin = str(ham)
    if not metin:
        return {}
    if metin.startswith(_ENC_ONEK):
        try:
            metin = _fernet().decrypt(metin[len(_ENC_ONEK):].encode()).decode()
        except PayloadDecryptError:
            raise
        except Exception as e:
            raise PayloadDecryptError(f"cozulemedi: {type(e).__name__}") from e
    return json.loads(metin)


def payload_sifreli_mi(ham) -> bool:
    return isinstance(ham, str) and ham.startswith(_ENC_ONEK)


def payload_yaz(veri: dict, sifreli: bool) -> str:
    """dict'i saklanacak metne cevirir. sifreli=True ise enc1: formatinda."""
    duz = json.dumps(veri, ensure_ascii=False)
    if not sifreli:
        return duz
    return _ENC_ONEK + _fernet().encrypt(duz.encode()).decode()


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
                eslesenler = []
                for row in rows:
                    # Satir basina koruma: TEK bir merchant'in bozuk payload'i
                    # (gecersiz JSON, dict yerine liste, beklenmedik tip) tum
                    # taramayi cokertiyordu — yani bir kaydin bozulmasi BUTUN
                    # magazalarin girisini kiriyordu. Bozuk satir atlanir,
                    # hangi kayit oldugu loglanir; arama devam eder.
                    try:
                        data = payload_coz(row["payload_json"])
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
                        eslesenler.append((row["username"], row["brand"], data))
                # Ayni shop_domain icin birden fazla kayit olusabiliyor: arama
                # basarisiz oldugunda cagiran taraf shop'tan username turetip
                # YENI kayit aciyor (auth.py _shop_to_username). Sonucu agir —
                # magaza bos bir hesaba giriyor, eski ayarlari "silinmis"
                # gorunuyor. id ASC siralamasi sayesinde her zaman EN ESKI,
                # yani gercek kayit kazanir; fazlasi loglanir.
                if len(eslesenler) > 1:
                    eslesenler.sort(key=lambda x: _kayit_oncelik(x[0], x[2], shop_domain),
                                    reverse=True)
                    logger.warning(
                        "[DB] ayni shop_domain icin %d kayit var: %s — secilen: %s/%s (digerleri: %s)",
                        len(eslesenler), shop_domain, eslesenler[0][0], eslesenler[0][1],
                        [(u, b) for u, b, _ in eslesenler[1:]],
                    )
                if eslesenler:
                    return (eslesenler[0][0], eslesenler[0][1])
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
                    # Satir basina koruma — lookup_username_by_shop ile ayni
                    # gerekce: tek bozuk payload butun listeyi [] yapiyordu.
                    # Sonucu agirdi: TID warmup bos doneyor, saglik monitoru
                    # hicbir magazayi gormuyor, app/uninstalled temizligi
                    # eslesecek kaydi bulamiyordu.
                    try:
                        settings = payload_coz(row["payload_json"])
                        if not isinstance(settings, dict):
                            raise TypeError(f"payload_json dict degil: {type(settings).__name__}")
                    except Exception as _row_err:
                        logger.warning(
                            "[DB] bozuk kayit atlandi (get_all): username=%s brand=%s — %s",
                            row.get("username"), row.get("brand"), _row_err,
                        )
                        continue
                    result.append({
                        "username": row["username"],
                        "brand": row["brand"],
                        "connection": {"settings": settings},
                    })
                return result
    except Exception as e:
        logger.error("[DB] get_all_shopify_connections hatası: %s", e)
        return []
