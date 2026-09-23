"""
Pixel sablonunun kisa hash'ini yazar.

Canlidaki GET /health -> pixel_sha degeri ile karsilastirmak icin: ayniysa
calisan kod bu commit ile ayni, farkliysa deploy yeni kodu almamis demektir.

Kullanim: python scripts/pixel-sha.py
"""
import ast
import hashlib
import io
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    src = io.open(os.path.join(ROOT, "routers", "live.py"), encoding="utf-8").read()
    for node in ast.parse(src).body:
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "_PIXEL_JS_TEMPLATE":
            tmpl = ast.literal_eval(node.value)
            print(hashlib.sha256(tmpl.encode("utf-8")).hexdigest()[:12])
            return
    print("_PIXEL_JS_TEMPLATE bulunamadi", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
