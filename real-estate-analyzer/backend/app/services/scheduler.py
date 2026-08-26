from __future__ import annotations

import logging
from datetime import datetime

from apscheduler.schedulers.background import BackgroundScheduler
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models import Listing, RunStatus, SavedSearch, ScrapeRun
from app.scrapers.base import SearchFilters
from app.scrapers.idealista import IdealistaScraper
from app.scrapers.immobiliare import ImmobiliareScraper
from app.services.analysis import recompute_price_per_sqm
from app.services.dedup import assign_cluster

logger = logging.getLogger(__name__)

SCRAPERS = {
    "immobiliare.it": ImmobiliareScraper,
    "idealista.it": IdealistaScraper,
}

scheduler = BackgroundScheduler()


def run_search(search_id: int) -> None:
    db = SessionLocal()
    try:
        search = db.get(SavedSearch, search_id)
        if not search or not search.active:
            return

        filters = SearchFilters(
            city=search.city,
            zone=search.zone,
            min_price=search.min_price,
            max_price=search.max_price,
            min_size_sqm=search.min_size_sqm,
            max_size_sqm=search.max_size_sqm,
            min_rooms=search.min_rooms,
            max_rooms=search.max_rooms,
        )

        for portal in search.portals:
            scraper_cls = SCRAPERS.get(portal)
            if not scraper_cls:
                continue
            _run_portal(db, search, portal, scraper_cls(), filters)
    finally:
        db.close()


def _run_portal(db: Session, search: SavedSearch, portal: str, scraper, filters: SearchFilters) -> None:
    run = ScrapeRun(search_id=search.id, portal=portal, status=RunStatus.RUNNING)
    db.add(run)
    db.commit()

    found = 0
    try:
        for scraped in scraper.search(filters):
            upsert_listing(db, scraped)
            found += 1
        run.status = RunStatus.SUCCESS
    except Exception as exc:  # noqa: BLE001
        logger.exception("Scrape failed for %s / search %s", portal, search.id)
        run.status = RunStatus.ERROR
        run.error_message = str(exc)
    finally:
        run.listings_found = found
        run.finished_at = datetime.utcnow()
        db.commit()


def upsert_listing(db: Session, scraped) -> Listing:
    existing = (
        db.query(Listing)
        .filter(Listing.source == scraped.source, Listing.source_id == scraped.source_id)
        .first()
    )
    if existing:
        for field in (
            "title", "price", "size_sqm", "rooms", "bathrooms", "floor", "city", "province",
            "zone", "address", "lat", "lon", "condition", "energy_class", "year_built",
            "description", "photos", "agency", "raw_data",
        ):
            setattr(existing, field, getattr(scraped, field))
        existing.last_seen_at = datetime.utcnow()
        existing.is_active = True
        listing = existing
    else:
        listing = Listing(
            source=scraped.source,
            source_id=scraped.source_id,
            url=scraped.url,
            title=scraped.title,
            price=scraped.price,
            size_sqm=scraped.size_sqm,
            rooms=scraped.rooms,
            bathrooms=scraped.bathrooms,
            floor=scraped.floor,
            city=scraped.city,
            province=scraped.province,
            zone=scraped.zone,
            address=scraped.address,
            lat=scraped.lat,
            lon=scraped.lon,
            condition=scraped.condition,
            energy_class=scraped.energy_class,
            year_built=scraped.year_built,
            description=scraped.description,
            photos=scraped.photos,
            agency=scraped.agency,
            raw_data=scraped.raw_data,
        )
        db.add(listing)

    recompute_price_per_sqm(listing)
    db.flush()
    assign_cluster(db, listing)
    db.commit()
    return listing


def start_scheduler() -> None:
    if scheduler.running:
        return
    db = SessionLocal()
    try:
        for search in db.query(SavedSearch).filter(SavedSearch.active.is_(True)).all():
            # Stagger periodic scrapes; every 6h per saved search by default.
            scheduler.add_job(
                run_search,
                "interval",
                hours=6,
                args=[search.id],
                id=f"search-{search.id}",
                replace_existing=True,
                next_run_time=datetime.utcnow(),
            )
    finally:
        db.close()
    scheduler.start()
