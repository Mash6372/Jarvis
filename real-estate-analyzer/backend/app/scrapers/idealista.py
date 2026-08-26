"""Scraper for idealista.it.

Idealista is protected by an aggressive anti-bot layer (Akamai/DataDome-style
challenges). A plain httpx GET will frequently get a 403 even with a
realistic User-Agent. In practice this scraper needs to run its HTTP layer
through a real headless browser (Playwright) with a persistent, warmed-up
browser context — plain requests are only good enough for quick manual
checks. That's why `fetch_html` is injected as a callable instead of hard
-coded: swap in a Playwright-backed fetcher for real runs.

Field extraction favors the JSON-LD `RealEstateListing`/`Product` block that
Idealista embeds for SEO, since it's far more stable than CSS class names
(which are obfuscated/hashed and change across deploys). This sandbox has no
network route to idealista.it, so none of this was validated live — treat
the CSS fallback selectors as a starting point to adjust against a real page.
"""
from __future__ import annotations

import re
from typing import Callable
from urllib.parse import urlencode

import httpx

from app.scrapers.base import BaseScraper, ScrapedListing, SearchFilters
from app.scrapers.utils import extract_json_ld, normalize_condition, polite_get

BASE_URL = "https://www.idealista.it"

FetchFn = Callable[[str], str | None]


class IdealistaScraper(BaseScraper):
    source_name = "idealista.it"

    def __init__(self, client: httpx.Client | None = None, fetch_html: FetchFn | None = None):
        self.client = client or httpx.Client(follow_redirects=True)
        self._fetch_html = fetch_html or self._default_fetch

    def _default_fetch(self, url: str) -> str | None:
        response = polite_get(self.client, url)
        return response.text if response is not None else None

    def _search_url(self, filters: SearchFilters, page: int) -> str:
        slug = filters.city.lower().strip().replace(" ", "-")
        params = {}
        if filters.min_price:
            params["prezzo-da"] = int(filters.min_price)
        if filters.max_price:
            params["prezzo-fino"] = int(filters.max_price)
        if filters.min_size_sqm:
            params["superficie-da"] = int(filters.min_size_sqm)
        if filters.max_size_sqm:
            params["superficie-fino"] = int(filters.max_size_sqm)
        query = f"?{urlencode(params)}" if params else ""
        pagination = f"pagina-{page}.htm" if page > 1 else ""
        return f"{BASE_URL}/vendita-case/{slug}/{pagination}{query}"

    def search(self, filters: SearchFilters):
        for page in range(1, max(1, filters.max_pages) + 1):
            html = self._fetch_html(self._search_url(filters, page))
            if not html:
                break
            cards = self._parse_search_cards(html)
            if not cards:
                break
            for card in cards:
                yield card

    def _parse_search_cards(self, html: str):
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        articles = soup.select("article.item")
        results = []
        for art in articles:
            try:
                link = art.select_one("a.item-link")
                if not link or not link.get("href"):
                    continue
                url = BASE_URL + link["href"] if link["href"].startswith("/") else link["href"]
                source_id_match = re.search(r"/immobile/(\d+)/", url)
                source_id = source_id_match.group(1) if source_id_match else url

                price_text = art.select_one(".item-price")
                price = _parse_price(price_text.get_text() if price_text else None)

                details = art.select(".item-detail")
                size_sqm = None
                rooms = None
                for detail in details:
                    text = detail.get_text(strip=True)
                    if "m" in text and size_sqm is None:
                        size_sqm = _parse_number(text)
                    elif ("local" in text.lower() or "cam" in text.lower()) and rooms is None:
                        rooms = int(_parse_number(text) or 0) or None

                results.append(
                    ScrapedListing(
                        source=self.source_name,
                        source_id=source_id,
                        url=url,
                        title=link.get_text(strip=True),
                        price=price,
                        size_sqm=size_sqm,
                        rooms=rooms,
                        raw_data={"card_html": str(art)},
                    )
                )
            except Exception:
                continue
        return results

    def parse_listing_page(self, url: str) -> ScrapedListing | None:
        html = self._fetch_html(url)
        if not html:
            return None

        source_id_match = re.search(r"/immobile/(\d+)/", url)
        source_id = source_id_match.group(1) if source_id_match else url

        json_ld = extract_json_ld(html)
        listing_block = next(
            (b for b in json_ld if "RealEstate" in str(b.get("@type", "")) or "Product" in str(b.get("@type", ""))),
            None,
        )

        if listing_block:
            offers = listing_block.get("offers", {})
            geo = listing_block.get("geo") or {}
            address = listing_block.get("address") or {}
            return ScrapedListing(
                source=self.source_name,
                source_id=source_id,
                url=url,
                title=listing_block.get("name"),
                price=_to_float(offers.get("price")) if isinstance(offers, dict) else None,
                description=listing_block.get("description"),
                lat=_to_float(geo.get("latitude")),
                lon=_to_float(geo.get("longitude")),
                address=address.get("streetAddress") if isinstance(address, dict) else None,
                city=address.get("addressLocality") if isinstance(address, dict) else None,
                condition=normalize_condition(listing_block.get("itemCondition")),
                raw_data=listing_block,
            )

        # Fallback: best-effort HTML selectors, calibrate against a live page.
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(html, "lxml")
        title = soup.select_one("span.main-info__title-main")
        price = soup.select_one(".info-data-price")
        return ScrapedListing(
            source=self.source_name,
            source_id=source_id,
            url=url,
            title=title.get_text(strip=True) if title else None,
            price=_parse_price(price.get_text() if price else None),
            raw_data={"fallback": True},
        )


def _parse_number(text: str) -> float | None:
    match = re.search(r"[\d.,]+", text)
    if not match:
        return None
    return _to_float(match.group(0))


def _parse_price(text: str | None) -> float | None:
    if not text:
        return None
    return _parse_number(text)


def _to_float(value) -> float | None:
    if value is None:
        return None
    try:
        if isinstance(value, str):
            return float(value.replace(".", "").replace(",", "."))
        return float(value)
    except (ValueError, TypeError):
        return None
