"""Kleiner Server für die Kalorien-App.

Liefert die App-Dateien aus und leitet die Lebensmittel-Suche an
Open Food Facts weiter (die Suche erlaubt keine direkten Browser-Anfragen).

Start:  python server.py   ->  http://localhost:8123
"""
import os
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(os.environ.get("PORT", 8123))  # Render gibt den Port vor
SEARCH_URL = "https://search.openfoodfacts.org/search"
FIELDS = "code,product_name,product_name_de,brands,nutriments"
USER_AGENT = "KalorienTracker/0.1 (Lernprojekt)"


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        if url.path == "/api/search":
            return self.search(urllib.parse.parse_qs(url.query).get("q", [""])[0])
        return super().do_GET()

    def search(self, q):
        q = q.strip()[:100]
        if not q:
            return self.send_json(400, b'{"error":"q fehlt"}')
        params = urllib.parse.urlencode({"q": q, "langs": "de", "page_size": 25, "fields": FIELDS})
        req = urllib.request.Request(f"{SEARCH_URL}?{params}", headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(req, timeout=15) as res:
                body = res.read()
            self.send_json(200, body)
        except Exception:
            self.send_json(502, b'{"error":"Suche nicht erreichbar"}')

    def send_json(self, status, body):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print(f"App läuft auf http://localhost:{PORT}  (Fenster offen lassen)")
    ThreadingHTTPServer(("", PORT), Handler).serve_forever()
