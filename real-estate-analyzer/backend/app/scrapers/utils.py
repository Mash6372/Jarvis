"""Shared helpers for scrapers: politeness throttling, robots.txt checks and
structured-data (JSON-LD) extraction, which is the most stable way to pull
listing fields since it doesn't depend on volatile CSS class names.
"""
from __future__ import annotations

import json
import random
import time
from urllib import robotparser
from urllib.parse import urlparse

import httpx

from app.config import settings

_last_request_at: dict[str, float] = {}
_robots_cache: dict[str, robotparser.RobotFileParser] = {}


def _domain(url: str) -> str:
    return urlparse(url).netloc


def is_allowed_by_robots(url: str) -> bool:
    if not settings.respect_robots_txt:
        return True
    domain = _domain(url)
    if domain not in _robots_cache:
        rp = robotparser.RobotFileParser()
        rp.set_url(f"https://{domain}/robots.txt")
        try:
            rp.read()
        except Exception:
            # If robots.txt can't be fetched, fail closed for safety.
            return False
        _robots_cache[domain] = rp
    return _robots_cache[domain].can_fetch(settings.user_agent, url)


def throttle(domain: str) -> None:
    """Sleep as needed so we never hit the same portal faster than the
    configured min/max delay. This is intentionally conservative — this tool
    is meant for personal deal analysis, not high-volume crawling."""
    now = time.monotonic()
    last = _last_request_at.get(domain)
    delay = random.uniform(settings.min_delay_seconds, settings.max_delay_seconds)
    if last is not None:
        elapsed = now - last
        if elapsed < delay:
            time.sleep(delay - elapsed)
    _last_request_at[domain] = time.monotonic()


class RobotsDisallowed(RuntimeError):
    """Raised instead of silently returning None, so a blocked scrape shows
    up as a clear error in ScrapeRun.error_message rather than looking like
    a successful run that just happened to find zero listings."""


def polite_get(client: httpx.Client, url: str) -> httpx.Response | None:
    if not is_allowed_by_robots(url):
        raise RobotsDisallowed(
            f"robots.txt vieta il fetch di {url} (o il file robots.txt non è raggiungibile)."
        )
    throttle(_domain(url))
    response = client.get(url, headers={"User-Agent": settings.user_agent}, timeout=settings.request_timeout_seconds)
    response.raise_for_status()
    return response


def extract_json_ld(html: str) -> list[dict]:
    """Return every JSON-LD block embedded in the page as parsed dicts."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    blocks = []
    for tag in soup.find_all("script", type="application/ld+json"):
        if not tag.string:
            continue
        try:
            data = json.loads(tag.string)
        except json.JSONDecodeError:
            continue
        blocks.extend(data if isinstance(data, list) else [data])
    return blocks


def extract_next_data(html: str) -> dict | None:
    """Many modern listing sites (Next.js apps) embed their full page props
    in a <script id="__NEXT_DATA__"> tag. When present this is far more
    reliable than scraping rendered HTML."""
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    tag = soup.find("script", id="__NEXT_DATA__")
    if not tag or not tag.string:
        return None
    try:
        return json.loads(tag.string)
    except json.JSONDecodeError:
        return None


def normalize_condition(raw: str | None) -> str:
    if not raw:
        return "unknown"
    text = raw.lower()
    if any(k in text for k in ["nuovo", "ottim"]):
        return "ottimo"
    if "buono" in text or "abitabile" in text:
        return "buono"
    if "ristruttur" in text:
        return "da_ristrutturare"
    if "grezzo" in text or "rustico" in text:
        return "grezzo"
    return "unknown"
