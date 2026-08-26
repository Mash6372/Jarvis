from datetime import datetime

from pydantic import BaseModel, ConfigDict


class SavedSearchIn(BaseModel):
    name: str
    city: str
    zone: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    min_size_sqm: float | None = None
    max_size_sqm: float | None = None
    min_rooms: int | None = None
    max_rooms: int | None = None
    portals: list[str] = ["immobiliare.it", "idealista.it"]


class SavedSearchOut(SavedSearchIn):
    model_config = ConfigDict(from_attributes=True)
    id: int
    active: bool
    created_at: datetime


class ListingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    source: str
    url: str
    title: str | None
    price: float | None
    size_sqm: float | None
    price_per_sqm: float | None
    rooms: int | None
    bathrooms: int | None
    floor: str | None
    city: str | None
    zone: str | None
    address: str | None
    lat: float | None
    lon: float | None
    condition: str
    energy_class: str | None
    photos: list
    agency: str | None
    cluster_id: int | None
    first_seen_at: datetime
    last_seen_at: datetime
    is_active: bool


class ListingFilter(BaseModel):
    city: str | None = None
    zone: str | None = None
    min_price: float | None = None
    max_price: float | None = None
    min_size_sqm: float | None = None
    max_size_sqm: float | None = None
    min_rooms: int | None = None
    max_rooms: int | None = None
    condition: str | None = None
    source: str | None = None
    only_active: bool = True
    sort_by: str = "deal_score"  # deal_score | price | price_per_sqm | size_sqm
    limit: int = 50
    offset: int = 0


class DealAnalysis(BaseModel):
    listing_id: int
    zone_avg_price_sqm_good_condition: float | None
    comparables_sample_size: int
    confidence: str  # "low" | "medium" | "high"
    estimated_after_reno_value: float | None
    estimated_renovation_cost: float | None
    estimated_transaction_costs: float | None
    estimated_total_investment: float | None
    estimated_margin: float | None
    estimated_roi_pct: float | None
    deal_score: float | None
    notes: list[str] = []
