"""One-off diagnostic script: fetches a real immobiliare.it search page and
reports whether __NEXT_DATA__ / JSON-LD are present, so we can see exactly
why the scraper's field extraction returns zero listings.

Run from the backend/ folder with the venv active:
    python debug_immobiliare.py
"""
import httpx

from app.scrapers.utils import extract_json_ld, extract_next_data

URL = "https://www.immobiliare.it/vendita-case/torino/?criterio=rilevanza&pag=1"
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
}

resp = httpx.get(URL, headers=HEADERS, follow_redirects=True, timeout=20)
print("STATUS:", resp.status_code)
print("RESPONSE LENGTH (chars):", len(resp.text))

data = extract_next_data(resp.text)
print("HAS __NEXT_DATA__ SCRIPT TAG:", data is not None)
if data:
    print("TOP-LEVEL KEYS:", list(data.keys()))
    props = data.get("props", {})
    print("props KEYS:", list(props.keys()))
    page_props = props.get("pageProps", {})
    print("props.pageProps KEYS:", list(page_props.keys()))

json_ld = extract_json_ld(resp.text)
print("JSON-LD BLOCKS FOUND:", len(json_ld))

with open("debug_immobiliare_response.html", "w", encoding="utf-8") as f:
    f.write(resp.text)
print("\nSaved full HTML response to debug_immobiliare_response.html for inspection.")
