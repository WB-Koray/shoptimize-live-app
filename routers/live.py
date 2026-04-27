"""
Storefront Live Activity — Redis entegreli versiyon.
Bağımsız servis olarak çalışır, mevcut shoptimize backend'e bağımlılık yok.
"""

import asyncio
import json
import logging
import os
import secrets
import time
from typing import Optional

import requests
from fastapi import APIRouter, Depends, Query, Request
from services.auth import get_current_user
from fastapi.responses import JSONResponse, Response, StreamingResponse

SHOPIFY_API_VERSION = os.getenv("SHOPIFY_API_VERSION", "2024-10")
from services.db import get_setting, set_connection_settings
from services.redis_store import store

logger = logging.getLogger(__name__)
router = APIRouter()

API_BASE_URL = os.getenv("API_BASE_URL", "https://api.shoptimize.com.tr").rstrip("/")

# ---------------------------------------------------------------------------
# Geriye dönük uyumluluk
# ---------------------------------------------------------------------------

def register_tid_owner(tid: str, username: str, brand: str):
    if not tid:
        return
    try:
        loop = asyncio.get_event_loop()
        if loop.is_running():
            asyncio.ensure_future(store.register_tid_owner(tid, username, brand))
        else:
            loop.run_until_complete(store.register_tid_owner(tid, username, brand))
    except Exception as e:
        logger.warning("[LIVE] register_tid_owner sync wrapper hatası: %s", e)


# ---------------------------------------------------------------------------
# pixel.js
# ---------------------------------------------------------------------------

_BOT_UA_KEYWORDS = (
    "googlebot", "adsbot-google", "mediapartners-google",
    "bingbot", "msnbot", "slurp", "duckduckbot",
    "baiduspider", "yandexbot", "facebookexternalhit",
    "twitterbot", "linkedinbot", "whatsapp",
    "semrushbot", "ahrefsbot", "mj12bot", "dotbot",
    "rogerbot", "seznambot", "pinterestbot", "applebot",
    "python-requests", "go-http-client", "axios/",
    "curl/", "wget/", "scrapy", "lighthouse",
)


def _is_bot(ua: str) -> bool:
    ua_lower = ua.lower()
    return any(k in ua_lower for k in _BOT_UA_KEYWORDS)


_PIXEL_JS_TEMPLATE = """
/* Shoptimize Storefront Pixel v2 */
if (window._spt_loaded) { /* already loaded */ } else {
window._spt_loaded = true;
(function () {
  'use strict';

  var TID = '{TID}';
  var API = '{API}';

  if (!TID || TID === '__NOTID__') {
    console.warn('[SPT] Tracking ID bulunamadı, pixel devre dışı.');
    return;
  }

  var VID = '';
  try {
    VID = localStorage.getItem('_spt_vid') || '';
    if (!VID) {
      VID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      localStorage.setItem('_spt_vid', VID);
    }
  } catch (e) {
    VID = Math.random().toString(36).slice(2, 10);
  }

  var UA = navigator.userAgent || '';
  var SW = screen.width || 0;

  var UTM = {};
  try {
    var _storedUtm = sessionStorage.getItem('_spt_utm');
    if (_storedUtm) { try { UTM = JSON.parse(_storedUtm); } catch(e) {} }
    var _usp = new URLSearchParams(location.search);
    var _hasNew = false;
    ['utm_source','utm_medium','utm_campaign','utm_content','utm_term'].forEach(function(k) {
      var v = _usp.get(k); if (v) { UTM[k] = v; _hasNew = true; }
    });
    if (_hasNew) sessionStorage.setItem('_spt_utm', JSON.stringify(UTM));
  } catch(e) {}

  var CID = '';
  try {
    CID = String(
      (window.ShopifyAnalytics && window.ShopifyAnalytics.meta &&
       window.ShopifyAnalytics.meta.page && window.ShopifyAnalytics.meta.page.customerId) ||
      (window.__st && window.__st.cid) || ''
    );
  } catch(e) {}

  function send(event_type, data) {
    var payload = JSON.stringify({
      tid: TID, vid: VID, event_type: event_type,
      url: location.href, referrer: document.referrer || '',
      ts: Date.now(), ua: UA, sw: SW,
      utm: UTM, customer_id: CID,
      data: data || {}
    });
    try {
      fetch(API + '/api/live/event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
        mode: 'cors',
      }).catch(function () {});
    } catch (e) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('POST', API + '/api/live/event', true);
        xhr.setRequestHeader('Content-Type', 'application/json');
        xhr.send(payload);
      } catch (e2) {}
    }
  }

  function getProductMeta() {
    try {
      var m = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
      if (m && m.product && m.product.title) return {
        product_id:     String(m.product.id || ''),
        product_title:  m.product.title,
        product_handle: m.product.handle || '',
        product_price:  m.product.price ? (m.product.price / 100).toFixed(2) : null,
        product_vendor: m.product.vendor || '',
        product_type:   m.product.type   || '',
        product_image:  m.product.featured_image || ''
      };
    } catch (e) {}
    try {
      var scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (var i = 0; i < scripts.length; i++) {
        var ld = JSON.parse(scripts[i].textContent);
        var item = ld['@type'] === 'Product' ? ld : (ld['@graph'] || []).find(function(x){ return x['@type'] === 'Product'; });
        if (item && item.name) {
          var imgs = item.image || [];
          var img  = typeof imgs === 'string' ? imgs : (imgs[0] || '');
          var offr = item.offers || {};
          if (Array.isArray(offr)) offr = offr[0] || {};
          return {
            product_id: '', product_title: item.name,
            product_handle: location.pathname.split('/products/')[1] || '',
            product_price: offr.price || null,
            product_vendor: (item.brand && item.brand.name) || '',
            product_type: item.category || '', product_image: img
          };
        }
      }
    } catch (e) {}
    try {
      var ogTitle = document.querySelector('meta[property="og:title"]');
      var ogImage = document.querySelector('meta[property="og:image"]');
      var ogPrice = document.querySelector('meta[property="product:price:amount"]');
      var ogBrand = document.querySelector('meta[property="og:brand"]');
      if (ogTitle && ogTitle.content) return {
        product_id: '', product_title: ogTitle.content,
        product_handle: location.pathname.split('/products/')[1] || '',
        product_price: ogPrice ? ogPrice.content : null,
        product_vendor: ogBrand ? ogBrand.content : '',
        product_type: '', product_image: ogImage ? ogImage.content : ''
      };
    } catch (e) {}
    try {
      var handle = location.pathname.split('/products/')[1];
      if (handle) {
        handle = handle.split('?')[0].split('/')[0];
        return {
          product_id: '', product_title: document.title.replace(/ [\\u2013\\-|].*/,'').trim() || handle,
          product_handle: handle, product_price: null,
          product_vendor: '', product_type: '', product_image: ''
        };
      }
    } catch (e) {}
    return {};
  }

  function fetchCartAndSend(base) {
    try {
      fetch('/cart.js', { credentials: 'same-origin' })
        .then(function(r) { return r.json(); })
        .then(function(cart) {
          var items = (cart.items || []).slice(0, 15).map(function(i) {
            return {
              title: i.title || i.product_title || '',
              price: i.price ? (i.price / 100).toFixed(2) : null,
              quantity: i.quantity || 1,
              variant_id: String(i.variant_id || ''),
              image: i.image || i.featured_image && i.featured_image.url || ''
            };
          });
          send('cart_viewed', Object.assign({}, base, {
            page_type: 'cart',
            cart_total: cart.total_price ? (cart.total_price / 100).toFixed(2) : null,
            cart_item_count: cart.item_count || 0,
            cart_items: items
          }));
        })
        .catch(function() { send('cart_viewed', Object.assign({}, base, { page_type: 'cart' })); });
    } catch(e) { send('cart_viewed', Object.assign({}, base, { page_type: 'cart' })); }
  }

  function trackPageView() {
    var path = location.pathname;
    var base = { title: document.title, path: path };
    if      (path.indexOf('/products/')    !== -1) send('product_viewed',    Object.assign({}, base, { page_type:'product' },    getProductMeta()));
    else if (path.indexOf('/collections/') !== -1) {
      var colHandle = path.split('/collections/')[1] || '';
      colHandle = colHandle.split('/')[0].split('?')[0];
      send('collection_viewed', Object.assign({}, base, { page_type:'collection', collection_handle: colHandle }));
    }
    else if (path.match(/^\\/cart/))               fetchCartAndSend(base);
    else if (path.indexOf('/search')       !== -1) {
      var q = ''; try { q = new URLSearchParams(location.search).get('q') || ''; } catch(e){}
      send('search_submitted', Object.assign({}, base, { page_type:'search', query:q }));
    }
    else                                           send('page_viewed', Object.assign({}, base, { page_type:'page' }));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', trackPageView);
  } else {
    trackPageView();
  }

  function parseCartBody(body) {
    if (!body) return {};
    if (typeof body === 'string') {
      try { return JSON.parse(body); } catch(e) {}
      try { var usp = new URLSearchParams(body); return { id: usp.get('id'), quantity: usp.get('quantity') }; } catch(e) {}
    }
    if (typeof body.get === 'function') return { id: body.get('id'), quantity: body.get('quantity') };
    return {};
  }

  function cartEventData(d) {
    var items = d.items;
    var id    = d.id || (items && items[0] && items[0].id);
    var qty   = d.quantity || (items && items[0] && items[0].quantity) || 1;
    return { variant_id: id, quantity: qty };
  }

  var _origFetch = window.fetch;
  window.fetch = function(resource, init) {
    var url = String(typeof resource === 'string' ? resource : (resource && resource.url) || '');
    if (url.indexOf('/cart/add') !== -1) {
      try { send('add_to_cart', cartEventData(parseCartBody((init || {}).body))); } catch(e) {}
    }
    return _origFetch.apply(this, arguments);
  };

  var _origOpen = XMLHttpRequest.prototype.open;
  var _origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._spt_url = String(url || '');
    return _origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._spt_url && this._spt_url.indexOf('/cart/add') !== -1) {
      try { send('add_to_cart', cartEventData(parseCartBody(body))); } catch(e) {}
    }
    return _origSend.apply(this, arguments);
  };

  document.addEventListener('submit', function(e) {
    var f = e.target;
    if (f && f.action && String(f.action).indexOf('/cart/add') !== -1) {
      try {
        var idEl = f.querySelector('[name="id"]');
        var qEl  = f.querySelector('[name="quantity"]');
        send('add_to_cart', { variant_id: idEl ? idEl.value : null, quantity: qEl ? (parseInt(qEl.value) || 1) : 1 });
      } catch(e) {}
    }
  }, true);

  document.addEventListener('click', function(e) {
    var el = e.target;
    for (var i = 0; i < 8 && el && el.tagName !== 'BODY'; i++) {
      var href = (el.getAttribute && el.getAttribute('href')) || '';
      var name = (el.getAttribute && el.getAttribute('name')) || '';
      var cls  = (el.className && typeof el.className === 'string') ? el.className : '';
      if (href.indexOf('/checkout') !== -1 || name === 'checkout' || cls.indexOf('checkout') !== -1) {
        send('checkout_started', {}); break;
      }
      el = el.parentElement;
    }
  }, true);

  document.addEventListener('cart:item-added', function(e) {
    try { send('add_to_cart', { product_title: e.detail && e.detail.product && e.detail.product.title }); } catch(er) {}
  });

  console.info('[SPT] Shoptimize pixel aktif. TID:', TID.slice(-8));
})();
} /* end _spt_loaded guard */
"""


@router.get("/pixel.js")
async def serve_pixel(tid: str = Query(""), request: Request = None):
    tracking_id = tid.strip() or "__NOTID__"
    js = _PIXEL_JS_TEMPLATE.replace("{TID}", tracking_id).replace("{API}", API_BASE_URL)
    return Response(content=js, media_type="application/javascript", headers={
        "Cache-Control": "no-cache",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET",
    })


# ---------------------------------------------------------------------------
# Event alıcı
# ---------------------------------------------------------------------------

_customer_to_tid: dict[str, dict] = {}
_vid_to_phone: dict[str, str] = {}
_email_to_phone: dict[str, str] = {}
_vid_to_name: dict[str, str] = {}
_email_to_name: dict[str, str] = {}


@router.post("/api/live/event")
async def receive_event(request: Request):
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid_json"}, status_code=400)

    tid = str(body.get("tid", "")).strip()
    if not tid:
        return JSONResponse({"ok": False, "error": "missing_tid"}, status_code=400)

    ua = str(body.get("ua", ""))[:512]
    if _is_bot(ua):
        return JSONResponse({"ok": True, "skipped": "bot"})

    vid = str(body.get("vid", ""))[:32]
    event_type = str(body.get("event_type", ""))[:64]
    url = str(body.get("url", ""))[:512]
    if await store.is_duplicate(tid, vid, event_type, url):
        return JSONResponse({"ok": True, "skipped": "duplicate"})

    raw_ip = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if not raw_ip:
        try:
            raw_ip = request.client.host if request.client else ""
        except Exception:
            raw_ip = ""

    event = {
        "tid": tid,
        "vid": vid,
        "event_type": event_type,
        "url": url,
        "referrer": str(body.get("referrer", ""))[:256],
        "ts": int(body.get("ts", time.time() * 1000)),
        "ua": str(body.get("ua", ""))[:512],
        "sw": int(body.get("sw", 0)),
        "ip": raw_ip[:64],
        "utm": body.get("utm") if isinstance(body.get("utm"), dict) else {},
        "customer_id": str(body.get("customer_id", ""))[:64],
        "data": body.get("data") if isinstance(body.get("data"), dict) else {},
    }

    await store.push_event(tid, event)

    owner = await store.get_tid_owner(tid)

    if event.get("customer_id"):
        _customer_to_tid[event["customer_id"]] = {
            "tid": tid, "vid": event["vid"],
            "username": owner[0] if owner else "",
            "brand": owner[1] if owner else "default",
        }

    return JSONResponse({"ok": True})


# ---------------------------------------------------------------------------
# SSE stream
# ---------------------------------------------------------------------------

@router.get("/api/live/stream")
async def sse_stream(request: Request, tid: str = Query(...), current_user: dict = Depends(get_current_user)):
    q = store.subscribe(tid)

    async def generate():
        for ev in await store.get_recent_events(tid, limit=200):
            yield f"data: {json.dumps(ev)}\n\n"
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    ev = await asyncio.wait_for(q.get(), timeout=25.0)
                    yield f"data: {json.dumps(ev)}\n\n"
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            store.unsubscribe(tid, q)

    return StreamingResponse(generate(), media_type="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
        "Access-Control-Allow-Origin": "*",
    })


@router.get("/api/live/events")
async def get_recent_events(tid: str = Query(...), limit: int = Query(50)):
    limit = min(limit, 5000)
    evs = await store.get_recent_events(tid, limit=limit)
    total = await store.count_events(tid)
    return {"ok": True, "events": evs, "total": total}


# ---------------------------------------------------------------------------
# Pixel kurulum
# ---------------------------------------------------------------------------

def _shopify_headers(token: str) -> dict:
    return {"X-Shopify-Access-Token": token, "Content-Type": "application/json"}


def _shopify_url(domain: str, path: str, version: str = None) -> str:
    domain = domain.replace("https://", "").replace("http://", "").strip().rstrip("/")
    v = version or SHOPIFY_API_VERSION
    return f"https://{domain}/admin/api/{v}/{path}"


def _get_or_create_tid(username: str, brand: str) -> str:
    existing = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
    if existing:
        return existing
    tid = "spt_" + secrets.token_hex(16)
    set_connection_settings(username, brand, "shopify", {"pixel_tracking_id": tid})
    return tid


def _find_our_scripttag(domain: str, token: str, version: str = None) -> Optional[dict]:
    try:
        r = requests.get(
            _shopify_url(domain, "script_tags.json", version),
            headers=_shopify_headers(token), timeout=15
        )
        if r.status_code != 200:
            return None
        for tag in r.json().get("script_tags", []):
            if tag.get("src", "").startswith(API_BASE_URL + "/pixel.js"):
                return tag
    except Exception:
        pass
    return None


@router.get("/api/shopify/pixel/status")
async def pixel_status(username: str = Query(""), brand: str = Query("default")):
    domain = get_setting(username, brand, "shopify", "shop_domain", "")
    token  = get_setting(username, brand, "shopify", "admin_api_token", "")
    tid    = get_setting(username, brand, "shopify", "pixel_tracking_id", "")
    if not domain or not token:
        return {"ok": False, "error": "shopify_not_connected"}
    tag = _find_our_scripttag(domain, token)
    if tid:
        await store.register_tid_owner(tid, username, brand)
    return {
        "ok": True,
        "installed": tag is not None,
        "tracking_id": tid or None,
        "script_tag_id": tag["id"] if tag else None,
        "script_url": tag.get("src") if tag else None,
    }


@router.post("/api/shopify/pixel/install")
async def pixel_install(username: str = Query(""), brand: str = Query("default")):
    domain  = get_setting(username, brand, "shopify", "shop_domain", "")
    token   = get_setting(username, brand, "shopify", "admin_api_token", "")
    version = get_setting(username, brand, "shopify", "api_version", SHOPIFY_API_VERSION)
    if not domain or not token:
        return JSONResponse({"ok": False, "error": "shopify_not_connected"}, status_code=400)
    existing = _find_our_scripttag(domain, token, version)
    if existing:
        tid = _get_or_create_tid(username, brand)
        await store.register_tid_owner(tid, username, brand)
        return {"ok": True, "already_installed": True, "tracking_id": tid, "script_tag_id": existing["id"]}
    tid = _get_or_create_tid(username, brand)
    await store.register_tid_owner(tid, username, brand)
    script_url = f"{API_BASE_URL}/pixel.js?tid={tid}"
    try:
        r = requests.post(
            _shopify_url(domain, "script_tags.json", version),
            json={"script_tag": {"event": "onload", "src": script_url}},
            headers=_shopify_headers(token), timeout=15
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    if r.status_code == 201:
        tag = r.json().get("script_tag", {})
        return {"ok": True, "installed": True, "tracking_id": tid, "script_tag_id": tag.get("id")}
    return JSONResponse({"ok": False, "error": r.text, "status": r.status_code}, status_code=502)


@router.delete("/api/shopify/pixel/uninstall")
async def pixel_uninstall(username: str = Query(""), brand: str = Query("default")):
    domain  = get_setting(username, brand, "shopify", "shop_domain", "")
    token   = get_setting(username, brand, "shopify", "admin_api_token", "")
    version = get_setting(username, brand, "shopify", "api_version", SHOPIFY_API_VERSION)
    if not domain or not token:
        return JSONResponse({"ok": False, "error": "shopify_not_connected"}, status_code=400)
    tag = _find_our_scripttag(domain, token, version)
    if not tag:
        return {"ok": True, "already_uninstalled": True}
    try:
        r = requests.delete(
            _shopify_url(domain, f"script_tags/{tag['id']}.json", version),
            headers=_shopify_headers(token), timeout=15
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    if r.status_code in (200, 204):
        return {"ok": True, "uninstalled": True}
    return JSONResponse({"ok": False, "error": r.text}, status_code=502)


# ---------------------------------------------------------------------------
# Müşteri bilgisi
# ---------------------------------------------------------------------------

@router.get("/api/shopify/customer")
async def get_shopify_customer(
    customer_id: str = Query(...),
    username: str = Query(""),
    brand: str = Query("default"),
):
    domain  = get_setting(username, brand, "shopify", "shop_domain", "")
    token   = get_setting(username, brand, "shopify", "admin_api_token", "")
    version = get_setting(username, brand, "shopify", "api_version", SHOPIFY_API_VERSION)
    if not domain or not token:
        return JSONResponse({"ok": False, "error": "shopify_not_connected"}, status_code=400)
    cid = str(customer_id).strip()
    if not cid or not cid.isdigit():
        return JSONResponse({"ok": False, "error": "invalid_customer_id"}, status_code=400)
    try:
        r = requests.get(
            _shopify_url(domain, f"customers/{cid}.json", version),
            headers=_shopify_headers(token), timeout=10,
        )
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)
    if r.status_code == 200:
        c = r.json().get("customer", {})
        return {"ok": True, "customer": {
            "id": c.get("id"), "first_name": c.get("first_name", ""),
            "last_name": c.get("last_name", ""), "email": c.get("email", ""),
            "phone": c.get("phone", ""), "orders_count": c.get("orders_count", 0),
            "total_spent": c.get("total_spent", "0.00"),
        }}
    return JSONResponse({"ok": False, "error": f"shopify_status_{r.status_code}"}, status_code=502)


# ---------------------------------------------------------------------------
# Webhook endpoint'leri
# ---------------------------------------------------------------------------

@router.post("/api/shopify/webhook/orders-create")
async def shopify_orders_webhook(
    request: Request,
    token: str = Query(""),
    username: str = Query(""),
    brand: str = Query("default"),
):
    stored_token = get_setting(username, brand, "shopify", "webhook_token", "")
    if stored_token and token != stored_token:
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)
    try:
        order = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid_json"}, status_code=400)

    customer     = order.get("customer") or {}
    customer_id  = str(customer.get("id", "")).strip()
    order_number = str(order.get("order_number") or order.get("name") or "")
    total_price  = str(order.get("total_price", "0"))

    session_info = _customer_to_tid.get(customer_id) if customer_id else None

    line_items = []
    for item in (order.get("line_items") or [])[:15]:
        line_items.append({
            "title": item.get("title", ""), "quantity": item.get("quantity", 1),
            "price": str(item.get("price", "0")), "variant_id": str(item.get("variant_id", "")),
            "sku": item.get("sku", ""),
        })

    ev_data = {
        "order_id": str(order.get("id", "")), "order_number": order_number,
        "total_price": total_price, "currency": order.get("currency", "TRY"),
        "customer_name": f"{customer.get('first_name', '')} {customer.get('last_name', '')}".strip(),
        "line_items": line_items,
    }

    if session_info:
        tid = session_info["tid"]
        vid = session_info["vid"]
        ev = {
            "tid": tid, "vid": vid, "event_type": "checkout_completed",
            "url": "", "referrer": "", "ts": int(time.time() * 1000),
            "ua": "", "sw": 0, "ip": "", "utm": {}, "customer_id": customer_id,
            "data": ev_data,
        }
        await store.push_event(tid, ev)
        return JSONResponse({"ok": True, "matched": True, "tid": tid})

    return JSONResponse({"ok": True, "matched": False})


@router.post("/api/shopify/webhook/checkouts-create")
async def shopify_checkouts_webhook(
    request: Request,
    token: str = Query(""),
    username: str = Query(""),
    brand: str = Query("default"),
):
    stored_token = get_setting(username, brand, "shopify", "webhook_token", "")
    if stored_token and token != stored_token:
        return JSONResponse({"ok": False, "error": "unauthorized"}, status_code=401)
    try:
        checkout = await request.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "invalid_json"}, status_code=400)

    phone       = str(checkout.get("phone") or checkout.get("billing_address", {}).get("phone") or "").strip()
    email       = str(checkout.get("email") or "").strip().lower()
    customer    = checkout.get("customer") or {}
    customer_id = str(customer.get("id") or "").strip()
    first_name  = str(customer.get("first_name") or checkout.get("billing_address", {}).get("first_name") or "").strip()
    last_name   = str(customer.get("last_name")  or checkout.get("billing_address", {}).get("last_name")  or "").strip()
    customer_name = f"{first_name} {last_name}".strip()

    if not phone:
        return JSONResponse({"ok": True, "matched": False, "reason": "no_phone"})

    if not phone.startswith("+"):
        digits = "".join(c for c in phone if c.isdigit())
        phone = f"+9{digits}" if digits.startswith("0") else f"+90{digits}"

    matched_vid = None
    if customer_id and customer_id in _customer_to_tid:
        matched_vid = _customer_to_tid[customer_id].get("vid")

    if matched_vid:
        _vid_to_phone[matched_vid] = phone
        if customer_name:
            _vid_to_name[matched_vid] = customer_name
    if email:
        _email_to_phone[email] = phone
        if customer_name:
            _email_to_name[email] = customer_name

    return JSONResponse({"ok": True, "matched": bool(matched_vid), "vid": matched_vid})


@router.post("/api/shopify/webhook/register")
async def register_order_webhook(username: str = Query(""), brand: str = Query("default")):
    domain  = get_setting(username, brand, "shopify", "shop_domain", "")
    token   = get_setting(username, brand, "shopify", "admin_api_token", "")
    version = get_setting(username, brand, "shopify", "api_version", SHOPIFY_API_VERSION)
    if not domain or not token:
        return JSONResponse({"ok": False, "error": "shopify_not_connected"}, status_code=400)

    wh_token = get_setting(username, brand, "shopify", "webhook_token", "")
    if not wh_token:
        wh_token = secrets.token_hex(16)
        set_connection_settings(username, brand, "shopify", {"webhook_token": wh_token})

    topics = [
        ("orders/create",    "orders-create"),
        ("checkouts/create", "checkouts-create"),
    ]
    results = {}
    for topic, slug in topics:
        callback_url = (
            f"{API_BASE_URL}/api/shopify/webhook/{slug}"
            f"?token={wh_token}&username={username}&brand={brand}"
        )
        try:
            r = requests.post(
                _shopify_url(domain, "webhooks.json", version),
                json={"webhook": {"topic": topic, "address": callback_url, "format": "json"}},
                headers=_shopify_headers(token), timeout=15,
            )
            if r.status_code in (200, 201):
                results[topic] = {"ok": True, "webhook_id": r.json().get("webhook", {}).get("id")}
            elif r.status_code == 422 and "taken" in r.text.lower():
                results[topic] = {"ok": True, "already_registered": True}
            else:
                results[topic] = {"ok": False, "error": r.text}
        except Exception as e:
            results[topic] = {"ok": False, "error": str(e)}

    return {"ok": True, "results": results}


@router.get("/api/shopify/webhook/status")
async def get_webhook_status(username: str = Query(""), brand: str = Query("default")):
    domain  = get_setting(username, brand, "shopify", "shop_domain", "")
    token   = get_setting(username, brand, "shopify", "admin_api_token", "")
    version = get_setting(username, brand, "shopify", "api_version", SHOPIFY_API_VERSION)
    if not domain or not token:
        return {"ok": False, "webhooks": []}
    try:
        r = requests.get(
            _shopify_url(domain, "webhooks.json?topic=orders/create", version),
            headers=_shopify_headers(token), timeout=10,
        )
        if r.status_code == 200:
            hooks = r.json().get("webhooks", [])
            ours  = [h for h in hooks if API_BASE_URL in h.get("address", "")]
            return {"ok": True, "registered": bool(ours), "webhooks": ours}
    except Exception:
        pass
    return {"ok": False, "webhooks": []}
