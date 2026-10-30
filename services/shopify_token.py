"""
Shopify Admin API token yönetimi — tek merkez.

NEDEN TEK MERKEZ
----------------
Shopify 1 Ocak 2027'den sonra "non-expiring" (süresiz) offline token'ları
GraphQL Admin API'de reddedecek. Yerine gelen expiring token 60 dakika
yaşıyor ve 90 günlük, her kullanımda değişen bir refresh token ile
yenileniyor.

Token'ı 30'dan fazla yerde doğrudan DB'den okuyorduk. Yenileme mantığını o
yerlerin her birine ayrı koymak mümkün değil; biri atlanırsa o kod yolu bir
saat sonra sessizce 401 almaya başlar. Bu yüzden bütün okumalar
``admin_token()`` üzerinden geçer ve yenileme sadece burada olur.

GEÇİŞ SIRASI — ÖNEMLİ
---------------------
1. Bu modül devreye girer. Davranış DEĞİŞMEZ: eski süresiz token'lar olduğu
   gibi kullanılmaya devam eder, sadece yenileme altyapısı hazır olur.
2. ``SHOPIFY_EXPIRING_TOKENS=1`` — yeni kurulumlar ve her mağaza açılışı
   expiring token almaya başlar.
3. ``scripts/token-migrate.py`` — oturum beklemeden mevcut mağazaların
   token'ları taşınır.

2. adım 1. adımdan önce yapılırsa arka plan işçileri (sepet kurtarma 60
saniyede bir, sağlık monitörü, kampanyalar) bir saat içinde durur.

SAKLANAN ALANLAR (payload_json içinde)
--------------------------------------
``admin_api_token``             Kullanılacak access token. Anahtar adı
                                değişmedi — eski okuma yerleri bozulmasın.
``admin_token_expires_at``      Unix ts. Yok/0 ise token süresiz (eski tip).
``admin_refresh_token``         Dönen refresh token.
``admin_refresh_expires_at``     Unix ts — refresh token'ın 90 günlük sonu.
``admin_api_token_legacy``      Taşıma öncesi süresiz token (7 günlük
                                kurtarma penceresi için saklanır).
``admin_token_migrated_at``     Taşımanın yapıldığı unix ts.
``admin_token_needs_reauth``    "1" ise yenileme kurtarılamadı; merchant'ın
                                uygulamayı açması gerekiyor.
"""

import logging
import os
import time
from typing import Optional

import requests

from services.db import get_payload, get_setting, set_connection_settings

logger = logging.getLogger(__name__)

SHOPIFY_CLIENT_ID     = os.getenv("SHOPIFY_CLIENT_ID", "")
SHOPIFY_CLIENT_SECRET = os.getenv("SHOPIFY_CLIENT_SECRET", "")
REDIS_URL             = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")

# 2. adımın anahtarı. Varsayılan kapalı: bu modülün devreye girmesi tek
# başına davranışı değiştirmesin.
EXPIRING_ENABLED = os.getenv("SHOPIFY_EXPIRING_TOKENS", "0").strip() in ("1", "true", "yes", "on")

OAUTH_YOL = "/admin/oauth/access_token"

TT_ID_TOKEN = "urn:ietf:params:oauth:token-type:id_token"
TT_OFFLINE  = "urn:shopify:params:oauth:token-type:offline-access-token"
TT_ONLINE   = "urn:shopify:params:oauth:token-type:online-access-token"
GT_EXCHANGE = "urn:ietf:params:oauth:grant-type:token-exchange"

K_TOKEN     = "admin_api_token"
K_EXPIRES   = "admin_token_expires_at"
K_REFRESH   = "admin_refresh_token"
K_REF_EXP   = "admin_refresh_expires_at"
K_LEGACY    = "admin_api_token_legacy"
K_MIGRATED  = "admin_token_migrated_at"
K_REAUTH    = "admin_token_needs_reauth"

# Son kullanmaya bu kadar saniye kalınca yenile. 60 dakikalık token için
# 10 dakika pay: bir yenileme başarısız olursa arka plan yenileyicisinin
# tekrar denemesi için vakit kalır.
YENILEME_PAYI = 600

# Kilit süresi: yenileme isteği 15 saniye timeout'lu, 45 saniye fazlasıyla
# yeter ve çöken bir süreç kilidi sonsuza kadar tutmaz.
KILIT_SURESI = 45

_ISTEK_TIMEOUT = 15


class TokenHatasi(Exception):
    """Yenileme kurtarılamadı — merchant'ın uygulamayı açması gerekiyor."""


class TokenGecici(Exception):
    """Geçici hata (timeout/5xx) — elimizdeki refresh token'la tekrar denenebilir."""


# ---------------------------------------------------------------------------
# Süreç içi önbellek
# ---------------------------------------------------------------------------
# Sadece son kullanma tarihi BİLİNEN (expiring) token'lar önbelleğe alınır.
# Süresiz token'lar her seferinde DB'den okunur: admin panelinden elle token
# değiştirilebiliyor, onu 60 dakika boyunca görmezden gelmek istemiyoruz.
_onbellek: dict[tuple[str, str], tuple[str, int]] = {}


def _onbellekten(username: str, brand: str) -> Optional[str]:
    kayit = _onbellek.get((username, brand))
    if not kayit:
        return None
    token, son = kayit
    if son - YENILEME_PAYI > time.time():
        return token
    _onbellek.pop((username, brand), None)
    return None


def _onbellege(username: str, brand: str, token: str, son: int) -> None:
    if token and son:
        _onbellek[(username, brand)] = (token, int(son))


def onbellek_bosalt(username: str = "", brand: str = "") -> None:
    """Token elle değiştirildiğinde çağrılır (admin uçları)."""
    if username:
        _onbellek.pop((username, brand), None)
    else:
        _onbellek.clear()


# ---------------------------------------------------------------------------
# Kilit — aynı mağaza için eşzamanlı yenilemeyi önler
# ---------------------------------------------------------------------------
# Yenileme her çağrıda YENİ bir refresh token döner ve eskisi, yenisi
# kullanılana kadar geçerli kalır. İki işçi aynı anda yenilerse ikisi ayrı
# çift alır; biri diğerinin yazdığını ezer ve o çift ölü kalır. Kilit bunu
# önler. Redis yoksa tek süreç varsayıp devam edilir — kilitsiz yenileme
# yenilememekten iyidir.

_redis_cli = None
_redis_denendi = False


def _redis():
    global _redis_cli, _redis_denendi
    if _redis_denendi:
        return _redis_cli
    _redis_denendi = True
    try:
        import redis as _r
        _redis_cli = _r.from_url(
            REDIS_URL, decode_responses=True,
            socket_connect_timeout=3, socket_timeout=3,
        )
        _redis_cli.ping()
    except Exception as e:
        logger.warning("[Token] Redis kilidi kullanılamıyor (%s) — kilitsiz devam", e)
        _redis_cli = None
    return _redis_cli


def _kilit_al(anahtar: str) -> bool:
    cli = _redis()
    if cli is None:
        return True
    try:
        return bool(cli.set(anahtar, "1", nx=True, ex=KILIT_SURESI))
    except Exception:
        return True


def _kilit_birak(anahtar: str) -> None:
    cli = _redis()
    if cli is None:
        return
    try:
        cli.delete(anahtar)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# OAuth isteği
# ---------------------------------------------------------------------------

def _oauth_post(shop: str, veri: dict, etiket: str) -> dict:
    """Shopify OAuth token ucuna form-encoded POST.

    Shopify dokümanları bu ucu x-www-form-urlencoded ile belgeliyor; expiring
    akışlarında belgelenen biçimden sapmamak için form gönderiyoruz.
    """
    shop_temiz = shop.replace("https://", "").replace("http://", "").strip().rstrip("/")
    url = f"https://{shop_temiz}{OAUTH_YOL}"
    try:
        r = requests.post(
            url, data=veri,
            headers={"Accept": "application/json"},
            timeout=_ISTEK_TIMEOUT,
        )
    except Exception as e:
        raise TokenGecici(f"{etiket}: ağ hatası — {e}") from e

    if r.status_code == 200:
        try:
            return r.json()
        except Exception as e:
            raise TokenGecici(f"{etiket}: 200 ama JSON değil — {e}") from e

    if r.status_code >= 500:
        raise TokenGecici(f"{etiket}: HTTP {r.status_code}")

    # 400/401/403 → kalıcı. Gövdeyi logla ama token/secret sızdırmadan.
    raise TokenHatasi(f"{etiket}: HTTP {r.status_code} — {r.text[:300]}")


def token_alanlari(yanit: dict) -> dict:
    """OAuth yanıtını payload_json alanlarına çevirir — saf fonksiyon, yazmaz.

    Çağıran taraf bunu kendi güncellemeleriyle (shop_domain, granted_scopes…)
    birleştirip TEK write yapabilir; iki ayrı yazma arasında kalan yarım
    durum olmaz.
    """
    access = (yanit.get("access_token") or "").strip()
    if not access:
        raise TokenHatasi("yanıtta access_token yok")

    simdi    = int(time.time())
    omur     = int(yanit.get("expires_in") or 0)
    ref      = (yanit.get("refresh_token") or "").strip()
    ref_omur = int(yanit.get("refresh_token_expires_in") or 0)

    alanlar = {K_TOKEN: access, K_REAUTH: ""}
    if omur:
        alanlar[K_EXPIRES] = simdi + omur
    if ref:
        alanlar[K_REFRESH] = ref
        alanlar[K_REF_EXP] = simdi + ref_omur if ref_omur else 0
    return alanlar


def _cift_kaydet(username: str, brand: str, yanit: dict) -> str:
    """Yanıttaki access+refresh çiftini DB'ye yazar ve access token'ı döner."""
    guncel = token_alanlari(yanit)
    access = guncel[K_TOKEN]
    omur   = int(yanit.get("expires_in") or 0)
    ref    = (yanit.get("refresh_token") or "").strip()
    simdi  = int(time.time())

    set_connection_settings(username, brand, "shopify", guncel)
    if omur:
        _onbellege(username, brand, access, simdi + omur)
    else:
        onbellek_bosalt(username, brand)

    logger.info(
        "[Token] ✓ çift kaydedildi: user=%s omur=%ss refresh=%s",
        username, omur or "suresiz", "var" if ref else "yok",
    )
    return access


# ---------------------------------------------------------------------------
# ID token → offline token (merchant uygulamayı açtığında)
# ---------------------------------------------------------------------------

def offline_token_al(shop: str, session_token: str, username: str, brand: str) -> str:
    """App Bridge session token'ını offline access token ile değiştirir.

    EXPIRING_ENABLED açıkken ``expiring=1`` gönderir ve dönen refresh
    token'ı da saklar. Kapalıyken eski (süresiz) davranışı korur.
    """
    veri = {
        "client_id":            SHOPIFY_CLIENT_ID,
        "client_secret":        SHOPIFY_CLIENT_SECRET,
        "grant_type":           GT_EXCHANGE,
        "subject_token":        session_token,
        "subject_token_type":   TT_ID_TOKEN,
        "requested_token_type": TT_OFFLINE,
    }
    if EXPIRING_ENABLED:
        veri["expiring"] = "1"

    try:
        yanit = _oauth_post(shop, veri, "offline-exchange")
    except (TokenHatasi, TokenGecici) as e:
        logger.warning("[Token] offline exchange başarısız: shop=%s — %s", shop, e)
        return ""

    try:
        return _cift_kaydet(username, brand, yanit)
    except TokenHatasi as e:
        logger.warning("[Token] offline exchange yanıtı kaydedilemedi: shop=%s — %s", shop, e)
        return ""


def online_token_al(shop: str, session_token: str) -> str:
    """Session token → kısa ömürlü ONLINE token. Online token her zaman
    expiring; refresh'i yok, süresi dolunca merchant yeniden açar."""
    veri = {
        "client_id":            SHOPIFY_CLIENT_ID,
        "client_secret":        SHOPIFY_CLIENT_SECRET,
        "grant_type":           GT_EXCHANGE,
        "subject_token":        session_token,
        "subject_token_type":   TT_ID_TOKEN,
        "requested_token_type": TT_ONLINE,
    }
    try:
        yanit = _oauth_post(shop, veri, "online-exchange")
        return (yanit.get("access_token") or "").strip()
    except (TokenHatasi, TokenGecici) as e:
        logger.warning("[Token] online exchange başarısız: shop=%s — %s", shop, e)
        return ""


def kod_degistir(shop: str, code: str) -> dict:
    """OAuth authorization code → access token. Ham yanıtı döner.

    Klasik kurulum akışı (App Store'dan "Yükle"). EXPIRING_ENABLED açıkken
    ``expiring=1`` ekler; yanıtı ``token_alanlari()`` ile saklanacak alanlara
    çevirin. Hata fırlatır — çağıran taraf kurulumu bitirmemeli.
    """
    veri = {
        "client_id":     SHOPIFY_CLIENT_ID,
        "client_secret": SHOPIFY_CLIENT_SECRET,
        "code":          code,
    }
    if EXPIRING_ENABLED:
        veri["expiring"] = "1"
    return _oauth_post(shop, veri, "code-grant")


# ---------------------------------------------------------------------------
# Yenileme
# ---------------------------------------------------------------------------

def yenile(username: str, brand: str, kayit: Optional[dict] = None) -> str:
    """Refresh token'la yeni access token alır. Başarısızsa "" döner.

    Kilit alınamazsa (başka bir süreç yeniliyor) kısa süre bekleyip DB'den
    taze token'ı okumayı dener — iki ayrı yenileme yapmaktan iyidir.
    """
    kayit = kayit if kayit is not None else get_payload(username, brand, "shopify")
    shop  = (kayit.get("shop_domain") or "").strip()
    ref   = (kayit.get(K_REFRESH) or "").strip()

    if not shop:
        logger.warning("[Token] yenileme atlandı: shop_domain yok user=%s", username)
        return ""
    if not ref:
        logger.warning("[Token] yenileme atlandı: refresh token yok shop=%s", shop)
        _reauth_isaretle(username, brand, shop, "refresh token yok")
        return ""

    anahtar = f"spt:tokenyenile:{username}:{brand}"
    if not _kilit_al(anahtar):
        logger.info("[Token] yenileme başkası tarafından yapılıyor: shop=%s — bekleniyor", shop)
        return _baskasini_bekle(username, brand)

    try:
        # Kilidi beklerken başkası bitirmiş olabilir — tekrar oku.
        taze = get_payload(username, brand, "shopify")
        if not _yenileme_gerekli(taze):
            return (taze.get(K_TOKEN) or "").strip()
        ref = (taze.get(K_REFRESH) or ref).strip()

        veri = {
            "client_id":     SHOPIFY_CLIENT_ID,
            "client_secret": SHOPIFY_CLIENT_SECRET,
            "grant_type":    "refresh_token",
            "refresh_token": ref,
        }
        try:
            yanit = _oauth_post(shop, veri, "refresh")
        except TokenGecici as e:
            # Geçici hata: refresh token'ı SAKLA. Shopify'da sunduğumuz
            # refresh token, yenisi kullanılana kadar geçerli kalıyor; bu
            # yüzden kaybedilen bir yanıt mağazayı kilitlemiyor. Arka plan
            # yenileyicisi tekrar dener.
            logger.warning("[Token] yenileme geçici hata: shop=%s — %s", shop, e)
            return (taze.get(K_TOKEN) or "").strip()
        except TokenHatasi as e:
            # Yarış: biz istek atarken merchant uygulamayı açmış ve Shopify
            # yeni bir çift vermiş olabilir. O durumda bizim sunduğumuz
            # refresh token emekliye ayrıldığı için 400 döner — ama mağaza
            # gayet sağlıklı. Kaydı tekrar okumadan reauth işaretlemek yanlış
            # alarm üretir; dahası arka plan yenileyici reauth işaretli
            # kayıtları atladığı için o mağaza bir daha yenilenmez.
            guncel = get_payload(username, brand, "shopify")
            if (guncel.get(K_REFRESH) or "").strip() not in ("", ref):
                logger.info(
                    "[Token] yenileme reddedildi ama refresh token bu arada "
                    "değişmiş: shop=%s — başkası tazelemiş, reauth yok", shop,
                )
                onbellek_bosalt(username, brand)
                return (guncel.get(K_TOKEN) or "").strip()
            logger.error("[Token] yenileme KALICI hata: shop=%s — %s", shop, e)
            _reauth_isaretle(username, brand, shop, str(e))
            return ""

        return _cift_kaydet(username, brand, yanit)
    finally:
        _kilit_birak(anahtar)


def _baskasini_bekle(username: str, brand: str, azami: float = 8.0) -> str:
    """Başka süreç yenilerken DB'den taze token'ı bekler."""
    bitis = time.time() + azami
    while time.time() < bitis:
        time.sleep(0.5)
        kayit = get_payload(username, brand, "shopify")
        if not _yenileme_gerekli(kayit):
            return (kayit.get(K_TOKEN) or "").strip()
    logger.warning("[Token] başka sürecin yenilemesi beklenirken zaman aşımı: user=%s", username)
    kayit = get_payload(username, brand, "shopify")
    return (kayit.get(K_TOKEN) or "").strip()


def _reauth_isaretle(username: str, brand: str, shop: str, sebep: str) -> None:
    """Kurtarılamayan yenileme — merchant'ın uygulamayı açması gerekiyor."""
    try:
        set_connection_settings(username, brand, "shopify", {K_REAUTH: "1"})
    except Exception:
        pass
    onbellek_bosalt(username, brand)
    try:
        import asyncio
        from services.notify import notify_operator
        if asyncio.get_event_loop().is_running():
            asyncio.ensure_future(notify_operator(
                f"⚠️ Token yenilenemedi: {shop} — merchant uygulamayı açmalı ({sebep[:120]})",
                dedupe_key=f"tokenreauth:{shop}", cooldown_sec=21600,
            ))
    except Exception:
        pass


def _yenileme_gerekli(kayit: dict) -> bool:
    son = int(kayit.get(K_EXPIRES) or 0)
    if not son:
        return False          # süresiz token — yenilenecek bir şey yok
    return son - YENILEME_PAYI <= time.time()


# ---------------------------------------------------------------------------
# ANA GİRİŞ NOKTASI
# ---------------------------------------------------------------------------

def admin_token(username: str, brand: str, shop_domain: str = "") -> str:
    """Kullanılmaya hazır Admin API token'ı döner.

    - Süresiz (eski tip) token varsa olduğu gibi döner.
    - Expiring token süresi dolmaya yakınsa önce yeniler.
    - Yenilenemezse "" döner: çağıran yerler zaten boş token'ı
      "Shopify bağlı değil" olarak ele alıyor.

    shop_domain sadece bilgi amaçlı; kaydın kendi shop_domain'i kullanılır.
    """
    onbellekli = _onbellekten(username, brand)
    if onbellekli:
        return onbellekli

    kayit = get_payload(username, brand, "shopify")
    token = (kayit.get(K_TOKEN) or "").strip()
    son   = int(kayit.get(K_EXPIRES) or 0)

    if not son:
        # Süresiz token. 1 Ocak 2027'den sonra Admin API bunu reddedecek;
        # taşıma scripti ile geçirilmeleri gerekiyor.
        return token

    if son - YENILEME_PAYI > time.time():
        _onbellege(username, brand, token, son)
        return token

    yeni = yenile(username, brand, kayit)
    return yeni or token      # yenileme patladıysa eski token belki hâlâ geçerli


def token_durumu(username: str, brand: str) -> dict:
    """Teşhis için token durumu — DEĞER SIZDIRMAZ, sadece üstveri."""
    kayit = get_payload(username, brand, "shopify")
    token = (kayit.get(K_TOKEN) or "").strip()
    son   = int(kayit.get(K_EXPIRES) or 0)
    ref   = (kayit.get(K_REFRESH) or "").strip()
    simdi = int(time.time())
    return {
        "username":      username,
        "brand":         brand,
        "shop_domain":   kayit.get("shop_domain", ""),
        "token_var":     bool(token),
        "token_uzunluk": len(token),
        "tip":           ("expiring" if son else ("suresiz" if token else "yok")),
        "son_kullanma":  son,
        "kalan_sn":      (son - simdi) if son else None,
        "refresh_var":   bool(ref),
        "refresh_son":   int(kayit.get(K_REF_EXP) or 0),
        "tasindi_ts":    int(kayit.get(K_MIGRATED) or 0),
        "reauth_gerek":  str(kayit.get(K_REAUTH) or "") == "1",
        "billing":       kayit.get("billing_status", ""),
    }


# ---------------------------------------------------------------------------
# Taşıma — oturum beklemeden süresiz token'ı expiring'e çevirir
# ---------------------------------------------------------------------------

def tasi(username: str, brand: str, kuru: bool = True) -> dict:
    """Süresiz offline token'ı expiring çifte taşır.

    DİKKAT: Shopify'ın doğrudan taşıma akışı eski token'ı GraphQL Admin API
    için KALICI olarak geçersiz kılar. Yanıt kaybolursa aynı eski token ile
    7 gün içinde tekrar denenirse Shopify AYNI çifti döner — bu yüzden eski
    token ``admin_api_token_legacy`` altında saklanır, silinmez.

    kuru=True iken hiçbir istek atılmaz, sadece ne yapılacağı raporlanır.
    """
    kayit = get_payload(username, brand, "shopify")
    shop  = (kayit.get("shop_domain") or "").strip()
    token = (kayit.get(K_TOKEN) or "").strip()
    son   = int(kayit.get(K_EXPIRES) or 0)

    temel = {"username": username, "brand": brand, "shop_domain": shop}

    if not shop:
        return {**temel, "ok": False, "durum": "shop_domain_yok"}
    if not token:
        return {**temel, "ok": False, "durum": "token_yok"}
    if son:
        return {**temel, "ok": True, "durum": "zaten_expiring", "kalan_sn": son - int(time.time())}
    if kuru:
        return {**temel, "ok": True, "durum": "kuru_tasinabilir", "token_uzunluk": len(token)}

    veri = {
        "client_id":            SHOPIFY_CLIENT_ID,
        "client_secret":        SHOPIFY_CLIENT_SECRET,
        "grant_type":           GT_EXCHANGE,
        "subject_token":        token,
        "subject_token_type":   TT_OFFLINE,
        "requested_token_type": TT_OFFLINE,
        "expiring":             "1",
    }
    try:
        yanit = _oauth_post(shop, veri, "migrate")
    except TokenGecici as e:
        # Eski token'a dokunmadık; güvenle tekrar denenebilir.
        return {**temel, "ok": False, "durum": "gecici_hata", "mesaj": str(e)}
    except TokenHatasi as e:
        return {**temel, "ok": False, "durum": "kalici_hata", "mesaj": str(e)}

    # Eski token'ı YENİ çiftten ÖNCE sakla: araya bir çökme girerse 7 günlük
    # kurtarma penceresinde tekrar deneyebilmek için elimizde kalsın.
    try:
        set_connection_settings(username, brand, "shopify", {
            K_LEGACY:   token,
            K_MIGRATED: int(time.time()),
        })
    except Exception as e:
        logger.error("[Token] eski token saklanamadı: shop=%s — %s", shop, e)

    try:
        _cift_kaydet(username, brand, yanit)
    except TokenHatasi as e:
        return {**temel, "ok": False, "durum": "kayit_hatasi", "mesaj": str(e)}

    yeni_son = int(time.time()) + int(yanit.get("expires_in") or 0)
    return {
        **temel, "ok": True, "durum": "tasindi",
        "omur_sn":      int(yanit.get("expires_in") or 0),
        "refresh_omur": int(yanit.get("refresh_token_expires_in") or 0),
        "son_kullanma": yeni_son,
    }


# ---------------------------------------------------------------------------
# Arka plan yenileyici
# ---------------------------------------------------------------------------

def yenilenmesi_gerekenler() -> list[dict]:
    """Son kullanmaya YENILEME_PAYI'ndan az kalmış expiring token'lar."""
    from services.db import get_all_shopify_connections
    sonuc = []
    for kayit in (get_all_shopify_connections() or []):
        ayar = (kayit.get("connection") or {}).get("settings") or {}
        alt  = ayar.get("settings")
        if isinstance(alt, dict):
            ayar = {**ayar, **alt}
        if not (ayar.get(K_TOKEN) or "").strip():
            continue
        if not _yenileme_gerekli(ayar):
            continue
        if str(ayar.get(K_REAUTH) or "") == "1":
            continue      # merchant müdahalesi bekliyor, boşa deneme
        sonuc.append({
            "username": kayit["username"],
            "brand":    kayit["brand"],
            "shop":     ayar.get("shop_domain", ""),
        })
    return sonuc
