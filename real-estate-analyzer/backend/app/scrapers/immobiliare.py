"""Scraper for immobiliare.it.

immobiliare.it is a Next.js app: search-result pages and listing pages embed
their full data payload in a <script id="__NEXT_DATA__"> tag as JSON. That is
far more reliable than parsing rendered HTML/CSS classes, which change often.

IMPORTANT: the exact key path inside __NEXT_DATA__ (e.g. props.pageProps...)
can shift when the site ships a new build. This sandbox has no network route
to immobiliare.it (outbound access is proxy-restricted here), so this code
could not be validated against a live page while writing it. Before relying
on it: run `python -m app.scrapers.immobiliare` style debug dump of
`extract_next_data(html)` against one real search page and one real listing
page, and adjust the `_dig(...)` paths below to match what you actually see.
"""
from __future__ import annotations

import re
from urllib.parse import urlencode

import httpx

from app.scrapers.base import BaseScraper, ScrapedListing, SearchFilters
from app.scrapers.utils import extract_json_ld, extract_next_data, normalize_condition, polite_get

BASE_URL = "https://www.immobiliare.it"


def _dig(d: dict, *path, default=None):
    cur = d
    for key in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
        if cur is None:
            return default
    return cur


class ImmobiliareScraper(BaseScraper):
    source_name = "immobiliare.it"

    def __init__(self, client: httpx.Client | None = None):
        self.client = client or httpx.Client(follow_redirects=True)

    def _search_url(self, filters: SearchFilters, page: int) -> str:
        # Vendita = for-sale listings, which is what a flip strategy needs.
        slug = filters.city.lower().strip().replace(" ", "-")
        params = {
            "criterio": "rilevanza",
            "pag": page,
        }
        if filters.min_price:
            params["prezzoMinimo"] = int(filters.min_price)
        if filters.max_price:
            params["prezzoMassimo"] = int(filters.max_price)
        if filters.min_size_sqm:
            params["superficieMinima"] = int(filters.min_size_sqm)
        if filters.max_size_sqm:
            params["superficieMassima"] = int(filters.max_size_sqm)
        if filters.min_rooms:
            params["localiMinimo"] = filters.min_rooms
        if filters.max_rooms:
            params["localiMassimo"] = filters.max_rooms
        return f"{BASE_URL}/vendita-case/{slug}/?{urlencode(params)}"

    def search(self, filters: SearchFilters):
        for page in range(1, max(1, filters.max_pages) + 1):
            url = self._search_url(filters, page)
            response = polite_get(self.client, url)
            data = extract_next_data(response.text)
            if not data:
                break
            # Expected (approximate) shape: props.pageProps.dehydratedState
            # ...results.results -> list of listing summaries.
            results = (
                _dig(data, "props", "pageProps", "results", "results")
                or _dig(data, "props", "pageProps", "listings")
                or []
            )
            if not results:
                break
            for item in results:
                listing = self._parse_search_item(item)
                if listing:
                    yield listing

    def _parse_search_item(self, item: dict) -> ScrapedListing | None:
        try:
            listing_id = str(item.get("id") or item.get("realEstateId"))
            seo = item.get("seo") or {}
            url = seo.get("url") or item.get("href") or ""
            if url and not url.startswith("http"):
                url = BASE_URL + url

            properties = item.get("properties") or item.get("realEstate", {}).get("properties") or [{}]
            prop = properties[0] if properties else {}

            price_info = item.get("price") or prop.get("price") or {}
            price = price_info.get("value") if isinstance(price_info, dict) else price_info

            return ScrapedListing(
                source=self.source_name,
                source_id=listing_id,
                url=url,
                title=item.get("title") or prop.get("caption"),
                price=_to_float(price),
                size_sqm=_to_float(prop.get("surface")),
                rooms=_to_int(prop.get("rooms")),
                bathrooms=_to_int(prop.get("bathrooms")),
                floor=prop.get("floor", {}).get("value") if isinstance(prop.get("floor"), dict) else prop.get("floor"),
                city=_dig(prop, "location", "city"),
                province=_dig(prop, "location", "province"),
                zone=_dig(prop, "location", "macrozone") or _dig(prop, "location", "microzone"),
                address=_dig(prop, "location", "address"),
                lat=_to_float(_dig(prop, "location", "latitude")),
                lon=_to_float(_dig(prop, "location", "longitude")),
                condition=normalize_condition(prop.get("condition") or prop.get("conditionValue")),
                energy_class=_dig(prop, "energy", "class"),
                photos=[p.get("url") for p in (item.get("multimedia", {}).get("photos") or []) if p.get("url")],
                agency=_dig(item, "advertiser", "agency", "displayName"),
                raw_data=item,
            )
        except Exception:
            return None

    def parse_listing_page(self, url: str) -> ScrapedListing | None:
        response = polite_get(self.client, url)

        json_ld = extract_json_ld(response.text)
        real_estate = next((b for b in json_ld if "RealEstate" in str(b.get("@type", ""))), None)

        next_data = extract_next_data(response.text)
        detail = _dig(next_data, "props", "pageProps", "detail") if next_data else None

        match = re.search(r"/annunci/(\d+)/", url)
        source_id = match.group(1) if match else url

        if detail:
            prop = (detail.get("properties") or [{}])[0]
            return ScrapedListing(
                source=self.source_name,
                source_id=source_id,
                url=url,
                title=detail.get("title"),
                price=_to_float(_dig(detail, "price", "value")),
                size_sqm=_to_float(prop.get("surface")),
                rooms=_to_int(prop.get("rooms")),
                bathrooms=_to_int(prop.get("bathrooms")),
                floor=prop.get("floor"),
                city=_dig(prop, "location", "city"),
                province=_dig(prop, "location", "province"),
                zone=_dig(prop, "location", "macrozone"),
                address=_dig(prop, "location", "address"),
                lat=_to_float(_dig(prop, "location", "latitude")),
                lon=_to_float(_dig(prop, "location", "longitude")),
                condition=normalize_condition(prop.get("condition")),
                energy_class=_dig(prop, "energy", "class"),
                description=detail.get("description"),
                photos=[p.get("url") for p in (detail.get("multimedia", {}).get("photos") or []) if p.get("url")],
                agency=_dig(detail, "advertiser", "agency", "displayName"),
                raw_data=detail,
            )

        if real_estate:
            offers = real_estate.get("offers", {})
            return ScrapedListing(
                source=self.source_name,
                source_id=source_id,
                url=url,
                title=real_estate.get("name"),
                price=_to_float(offers.get("price")),
                description=real_estate.get("description"),
                raw_data=real_estate,
            )

        return None


def _to_float(value) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).replace(".", "").replace(",", ".")) if isinstance(value, str) else float(value)
    except (ValueError, TypeError):
        return None


def _to_int(value) -> int | None:
    f = _to_float(value)
    return int(f) if f is not None else None
