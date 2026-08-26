from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class SearchFilters:
    city: str
    zone: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    min_size_sqm: float | None = None
    max_size_sqm: float | None = None
    min_rooms: int | None = None
    max_rooms: int | None = None
    max_pages: int = 3


@dataclass
class ScrapedListing:
    source: str
    source_id: str
    url: str
    title: str | None = None
    price: float | None = None
    size_sqm: float | None = None
    rooms: int | None = None
    bathrooms: int | None = None
    floor: str | None = None
    city: str | None = None
    province: str | None = None
    zone: str | None = None
    address: str | None = None
    lat: float | None = None
    lon: float | None = None
    condition: str = "unknown"
    energy_class: str | None = None
    year_built: int | None = None
    description: str | None = None
    photos: list[str] = field(default_factory=list)
    agency: str | None = None
    raw_data: dict = field(default_factory=dict)


class BaseScraper(ABC):
    """Contract every portal scraper must implement.

    Real deployments should run this against Playwright-rendered pages when a
    portal is a JS-heavy SPA and blocks plain HTTP requests. The interface is
    kept sync + generator-based so it plugs cleanly into the APScheduler job.
    """

    source_name: str

    @abstractmethod
    def search(self, filters: SearchFilters):
        """Yield ScrapedListing for each result across paginated search
        results, respecting filters.max_pages."""
        raise NotImplementedError

    @abstractmethod
    def parse_listing_page(self, url: str) -> ScrapedListing | None:
        """Fetch and parse a single listing page. Used both by search() and
        by a 'paste a link' manual-import fallback."""
        raise NotImplementedError
