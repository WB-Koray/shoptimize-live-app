"""
Postgres sifresini Coolify uzerinden guvenli sekilde donduren yardimci.

NEDEN: DSN birden fazla uygulamanin env'inde duruyor. Birini atlarsan o uygulama
DB'ye baglanamaz ve bunu ancak kullanici sikayet edince fark edersin. Bu script
once TARAR, hangi uygulamanin hangi degiskeninde DSN oldugunu tahmin etmeden
listeler; sonra hepsini birden gunceller.

ONEMLI — sifreyi bu script DEGISTIRMEZ:
    Coolify'daki veritabani sifre alanini degistirmek, zaten kurulmus bir
    Postgres'in sifresini degistirmez. O alan yalniz konteyner ilk
    olusturulurken (POSTGRES_PASSWORD) kullanilir; veri birimi (volume) mevcut
    oldugu icin sonraki aciliislarda yok sayilir. Gercek degisiklik SQL ile
    yapilir. Script sana tam komutu verir, sen calistirirsin.

KULLANIM:
    # 1) Once tara — hicbir seye dokunmaz
    python scripts/rotate-db-password.py scan

    # 2) Yeni sifre uret ve Postgres'te degistir (script komutu yazdirir)
    python scripts/rotate-db-password.py newpass

    # 3) Env'leri guncelle + redeploy
    python scripts/rotate-db-password.py apply

ORTAM DEGISKENLERI:
    COOLIFY_URL       ornek: https://coolify.ornek.com   (sonunda /api/v1 olmadan)
    COOLIFY_TOKEN     Coolify > Keys & Tokens > API tokens
    NEW_DB_PASSWORD   yalniz 'apply' icin
"""
import os
import re
import secrets
import sys

import requests

BASE = os.getenv("COOLIFY_URL", "").strip().rstrip("/")
TOKEN = os.getenv("COOLIFY_TOKEN", "").strip()
NEW_PW = os.getenv("NEW_DB_PASSWORD", "").strip()

# kullanici:SIFRE@host  — sifre kismini yakalar
_DSN_RE = re.compile(r"(postgres(?:ql)?://[^:@/\s]+:)([^@\s]+)(@\S+)")


def api(method, path, quiet=False, **kw):
    url = f"{BASE}/api/v1{path}"
    r = requests.request(
        method, url,
        headers={"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"},
        timeout=30, **kw,
    )
    if r.status_code >= 400:
        if not quiet:
            print(f"  HATA {r.status_code} {method} {path}: {r.text[:200]}")
        return None
    try:
        return r.json()
    except Exception:
        return {}


# Coolify surumleri env ucunu farkli adlandirdi. Dokumantasyon guncel surume
# ait; eski beta'larda /envs kullaniliyor. Hangisinin tuttugunu deneyerek bul.
_ENV_YOL_ADAYLARI = [
    "/applications/{uuid}/envs",
    "/applications/{uuid}/environment-variables",
    "/applications/{uuid}/environment_variables",
]
_env_yolu = None


def env_yolu_bul(ornek_uuid):
    """Calisan env yolu kalibini doner, bulamazsa None."""
    global _env_yolu
    if _env_yolu:
        return _env_yolu
    for kalip in _ENV_YOL_ADAYLARI:
        if api("GET", kalip.format(uuid=ornek_uuid), quiet=True) is not None:
            _env_yolu = kalip
            print(f"  (env ucu: {kalip})")
            return kalip
    return None


def maskele(dsn):
    def _m(m):
        pw = m.group(2)
        gorunen = pw[:3] + "*" * max(0, len(pw) - 6) + pw[-3:] if len(pw) > 8 else "****"
        return m.group(1) + gorunen + m.group(3)
    return _DSN_RE.sub(_m, dsn)


def dsn_iceren_degiskenler():
    """[(app_adi, app_uuid, degisken_adi, mevcut_deger)] doner."""
    apps = api("GET", "/applications") or []
    if not isinstance(apps, list):
        print("Uygulama listesi alinamadi.")
        sys.exit(1)

    if not apps:
        print("Hic uygulama donmedi.")
        sys.exit(1)

    kalip = env_yolu_bul(apps[0].get("uuid", ""))
    if not kalip:
        print("\nEnv ucu bulunamadi. Denenen yollar:")
        for k in _ENV_YOL_ADAYLARI:
            print(f"  {k}")
        print("Token'da 'read:sensitive' izni var mi kontrol et; yoksa da 404/403 gelebilir.")
        sys.exit(1)

    bulunan = []
    for app in apps:
        uuid = app.get("uuid", "")
        ad = app.get("name") or uuid
        envs = api("GET", kalip.format(uuid=uuid)) or []
        for e in envs if isinstance(envs, list) else []:
            deger = str(e.get("value") or "")
            if _DSN_RE.search(deger):
                bulunan.append((ad, uuid, e.get("key", ""), deger))
    return apps, bulunan


def cmd_scan():
    apps, bulunan = dsn_iceren_degiskenler()
    print(f"\n{'='*78}")
    print(f"{len(apps)} uygulama tarandi — {len(bulunan)} degiskende Postgres DSN bulundu")
    print(f"{'='*78}")
    if not bulunan:
        print("\nHicbir uygulamada DSN yok. Token'in tum kaynaklari gorebildiginden emin ol.")
        return
    son_app = None
    for ad, uuid, key, deger in bulunan:
        if ad != son_app:
            print(f"\n  {ad}  ({uuid})")
            son_app = ad
        print(f"    {key}")
        print(f"      {maskele(deger)}")
    print(f"\n{'='*78}")
    print("Bu degiskenlerin HEPSI 'apply' ile guncellenecek.")
    print("Listede beklemedigin bir sey varsa once onu konus.\n")


def cmd_newpass():
    pw = secrets.token_urlsafe(32)
    print("\nYeni sifre (DSN'de guvenli karakterler):\n")
    print(f"    {pw}\n")
    print("Simdi Postgres'te DEGISTIR — Coolify'daki sifre alani tek basina yetmez,")
    print("zaten kurulmus bir veritabaninin sifresini degistirmez.\n")
    print("Coolify > shoptimize-postgres > Terminal (ya da sunucuda docker exec):\n")
    print(f"    psql -U postgres -c \"ALTER USER postgres WITH PASSWORD '{pw}';\"\n")
    print("Sonra:\n")
    print(f"    $env:NEW_DB_PASSWORD = \"{pw}\"")
    print("    python scripts/rotate-db-password.py apply\n")
    print("Coolify'daki veritabani sifre alanini da ayni degerle guncelle ki")
    print("arayuzdeki baglanti dizesi dogru kalsin.\n")


def cmd_apply():
    if not NEW_PW:
        print("HATA: NEW_DB_PASSWORD tanimli degil. Once 'newpass' calistir.")
        sys.exit(1)
    if re.search(r"[@:/#?%\s]", NEW_PW):
        print("HATA: Sifre DSN'i bozacak karakter iceriyor (@ : / # ? % bosluk).")
        sys.exit(1)

    apps, bulunan = dsn_iceren_degiskenler()
    if not bulunan:
        print("Guncellenecek degisken bulunamadi.")
        return

    print(f"\n{len(bulunan)} degisken guncellenecek:")
    for ad, _u, key, _v in bulunan:
        print(f"  {ad} / {key}")
    if input("\nDevam? (evet/hayir): ").strip().lower() not in ("evet", "e", "yes", "y"):
        print("Iptal edildi.")
        return

    guncellenen_uuidler = []
    atlanan = []
    for ad, uuid, key, deger in bulunan:
        # Eski sifre icinde kodlanmamis '@' varsa regex ilk '@'te durur ve
        # sifrenin kalani host'a karisir. group(3) zaten '@' ile basladigi icin
        # esik 1: birden fazlaysa DSN belirsiz. Sessizce bozmaktansa atla.
        eslesme = _DSN_RE.search(deger)
        if eslesme and eslesme.group(3).count("@") > 1:
            atlanan.append((ad, key))
            print(f"  ATLANDI: {ad} / {key} — DSN'de birden fazla '@', elle duzeltilmeli")
            continue
        yeni = _DSN_RE.sub(lambda m: m.group(1) + NEW_PW + m.group(3), deger)
        sonuc = api("PATCH", _env_yolu.format(uuid=uuid),
                    json={"key": key, "value": yeni})
        if sonuc is None:
            print(f"  BASARISIZ: {ad} / {key}  — devam ediliyor, sonunda ozet var")
            continue
        print(f"  guncellendi: {ad} / {key}")
        if uuid not in guncellenen_uuidler:
            guncellenen_uuidler.append(uuid)

    if atlanan:
        print(f"\n{len(atlanan)} degisken ATLANDI — bunlari elle duzelt:")
        for ad, key in atlanan:
            print(f"  {ad} / {key}")

    if not guncellenen_uuidler:
        print("\nHicbir degisken guncellenemedi. Redeploy yapilmadi.")
        sys.exit(1)

    print(f"\n{len(guncellenen_uuidler)} uygulama redeploy ediliyor...")
    sonuc = api("POST", "/deploy", params={"uuid": ",".join(guncellenen_uuidler)})
    print("  deploy tetiklendi" if sonuc is not None else "  deploy TETIKLENEMEDI — Coolify'dan elle yap")

    print("\nDeploy bitince dogrula:")
    for app in apps:
        if app.get("uuid") in guncellenen_uuidler and app.get("fqdn"):
            print(f"  {app['fqdn'].split(',')[0]}/health")
    print()


def main():
    if not BASE or not TOKEN:
        print(__doc__)
        print("HATA: COOLIFY_URL ve COOLIFY_TOKEN ortam degiskenleri gerekli.")
        sys.exit(1)
    komut = (sys.argv[1] if len(sys.argv) > 1 else "scan").lower()
    if komut == "scan":
        cmd_scan()
    elif komut == "newpass":
        cmd_newpass()
    elif komut == "apply":
        cmd_apply()
    else:
        print(__doc__)
        sys.exit(1)


if __name__ == "__main__":
    main()
