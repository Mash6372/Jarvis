from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Listing
from app.schemas import DealAnalysis, ListingFilter, ListingOut
from app.scrapers.base import ScrapedListing
from app.scrapers.idealista import IdealistaScraper
from app.scrapers.immobiliare import ImmobiliareScraper
from app.services.analysis import analyze_deal, recompute_price_per_sqm
from app.services.scheduler import upsert_listing

router = APIRouter(prefix="/api/listings", tags=["listings"])


class ListingWithDeal(ListingOut):
    deal: DealAnalysis | None = None


@router.get("", response_model=list[ListingWithDeal])
def list_listings(filters: ListingFilter = Depends(), db: Session = Depends(get_db)):
    query = db.query(Listing)
    if filters.only_active:
        query = query.filter(Listing.is_active.is_(True))
    if filters.q:
        query = query.filter(Listing.title.ilike(f"%{filters.q}%"))
    if filters.city:
        query = query.filter(Listing.city.ilike(f"%{filters.city}%"))
    if filters.zone:
        query = query.filter(Listing.zone.ilike(f"%{filters.zone}%"))
    if filters.min_price is not None:
        query = query.filter(Listing.price >= filters.min_price)
    if filters.max_price is not None:
        query = query.filter(Listing.price <= filters.max_price)
    if filters.min_size_sqm is not None:
        query = query.filter(Listing.size_sqm >= filters.min_size_sqm)
    if filters.max_size_sqm is not None:
        query = query.filter(Listing.size_sqm <= filters.max_size_sqm)
    if filters.min_rooms is not None:
        query = query.filter(Listing.rooms >= filters.min_rooms)
    if filters.max_rooms is not None:
        query = query.filter(Listing.rooms <= filters.max_rooms)
    if filters.min_bathrooms is not None:
        query = query.filter(Listing.bathrooms >= filters.min_bathrooms)
    if filters.max_bathrooms is not None:
        query = query.filter(Listing.bathrooms <= filters.max_bathrooms)
    if filters.floor:
        query = query.filter(Listing.floor == filters.floor)
    if filters.condition:
        query = query.filter(Listing.condition == filters.condition)
    if filters.source:
        query = query.filter(Listing.source == filters.source)
    if filters.search_id is not None:
        query = query.filter(Listing.search_id == filters.search_id)

    if filters.sort_by == "price":
        query = query.order_by(Listing.price.asc())
    elif filters.sort_by == "price_per_sqm":
        query = query.order_by(Listing.price_per_sqm.asc())
    elif filters.sort_by == "size_sqm":
        query = query.order_by(Listing.size_sqm.desc())
    # "deal_score" sorting happens after computing analysis below, since it's derived.

    listings = query.offset(filters.offset).limit(max(filters.limit, 200) if filters.sort_by == "deal_score" else filters.limit).all()

    results = []
    for listing in listings:
        deal_result = analyze_deal(db, listing)
        results.append(
            ListingWithDeal(
                **ListingOut.model_validate(listing).model_dump(),
                deal=DealAnalysis(listing_id=listing.id, **deal_result.__dict__),
            )
        )

    if filters.sort_by == "deal_score":
        results.sort(key=lambda r: (r.deal.deal_score or 0), reverse=True)
        results = results[filters.offset : filters.offset + filters.limit]

    return results


@router.get("/{listing_id}", response_model=ListingWithDeal)
def get_listing(listing_id: int, db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    deal_result = analyze_deal(db, listing)
    return ListingWithDeal(
        **ListingOut.model_validate(listing).model_dump(),
        deal=DealAnalysis(listing_id=listing.id, **deal_result.__dict__),
    )


class ImportLinkRequest(BaseModel):
    url: str


PORTAL_SCRAPERS = {
    "immobiliare.it": ImmobiliareScraper,
    "idealista.it": IdealistaScraper,
}


@router.post("/import", response_model=ListingWithDeal, status_code=201)
def import_from_link(payload: ImportLinkRequest, db: Session = Depends(get_db)):
    """Low-risk fallback: import a single listing by pasting its URL, instead
    of relying on automated search scraping."""
    portal = next((name for name in PORTAL_SCRAPERS if name in payload.url), None)
    if not portal:
        raise HTTPException(400, "URL non riconosciuto (portali supportati: immobiliare.it, idealista.it)")

    scraper = PORTAL_SCRAPERS[portal]()
    try:
        scraped = scraper.parse_listing_page(payload.url)
    except Exception as exc:  # noqa: BLE001 surface the real cause to the caller
        raise HTTPException(422, f"Impossibile estrarre i dati dall'annuncio: {exc}")
    if not scraped:
        raise HTTPException(422, "Impossibile estrarre i dati dall'annuncio: struttura pagina non riconosciuta.")

    listing = upsert_listing(db, scraped)
    deal_result = analyze_deal(db, listing)
    return ListingWithDeal(
        **ListingOut.model_validate(listing).model_dump(),
        deal=DealAnalysis(listing_id=listing.id, **deal_result.__dict__),
    )


class ManualListingIn(BaseModel):
    """Both immobiliare.it and idealista.it block automated fetches (see
    ImportLinkRequest above) — this is the reliable path: you read the
    listing yourself and type in the numbers that matter for the analysis."""

    url: str
    source: str = "manuale"
    title: str | None = None
    price: float
    size_sqm: float
    rooms: int | None = None
    bathrooms: int | None = None
    floor: str | None = None
    city: str
    zone: str | None = None
    address: str | None = None
    condition: str = "unknown"
    search_id: int | None = None


@router.post("/manual", response_model=ListingWithDeal, status_code=201)
def add_manual_listing(payload: ManualListingIn, db: Session = Depends(get_db)):
    scraped = ScrapedListing(
        source=payload.source,
        source_id=payload.url,
        url=payload.url,
        title=payload.title,
        price=payload.price,
        size_sqm=payload.size_sqm,
        rooms=payload.rooms,
        bathrooms=payload.bathrooms,
        floor=payload.floor,
        city=payload.city,
        zone=payload.zone,
        address=payload.address,
        condition=payload.condition,
        search_id=payload.search_id,
    )
    listing = upsert_listing(db, scraped)
    deal_result = analyze_deal(db, listing)
    return ListingWithDeal(
        **ListingOut.model_validate(listing).model_dump(),
        deal=DealAnalysis(listing_id=listing.id, **deal_result.__dict__),
    )


@router.put("/{listing_id}", response_model=ListingWithDeal)
def update_listing(listing_id: int, payload: ManualListingIn, db: Session = Depends(get_db)):
    """Edit the characteristics of an already-stored listing (manual or
    auto-scraped) — reuses the same field set as manual entry."""
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")

    listing.source = payload.source
    listing.source_id = payload.url
    listing.url = payload.url
    listing.title = payload.title
    listing.price = payload.price
    listing.size_sqm = payload.size_sqm
    listing.rooms = payload.rooms
    listing.bathrooms = payload.bathrooms
    listing.floor = payload.floor
    listing.city = payload.city
    listing.zone = payload.zone
    listing.address = payload.address
    listing.condition = payload.condition
    listing.search_id = payload.search_id

    recompute_price_per_sqm(listing)
    db.commit()
    db.refresh(listing)

    deal_result = analyze_deal(db, listing)
    return ListingWithDeal(
        **ListingOut.model_validate(listing).model_dump(),
        deal=DealAnalysis(listing_id=listing.id, **deal_result.__dict__),
    )


@router.delete("/{listing_id}", status_code=204)
def delete_listing(listing_id: int, db: Session = Depends(get_db)):
    listing = db.get(Listing, listing_id)
    if not listing:
        raise HTTPException(404, "Listing not found")
    db.delete(listing)
    db.commit()
