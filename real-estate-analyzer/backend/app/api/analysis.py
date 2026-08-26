from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Listing
from app.services.analysis import GOOD_CONDITIONS

router = APIRouter(prefix="/api/analysis", tags=["analysis"])


@router.get("/zones")
def zone_stats(city: str = Query(...), db: Session = Depends(get_db)):
    """Median price/sqm per zone, split by 'good condition' comparables vs
    'needs renovation' stock, so you can eyeball the flip spread per zone."""
    rows = (
        db.query(
            Listing.zone,
            Listing.condition,
            func.count(Listing.id).label("n"),
            func.avg(Listing.price_per_sqm).label("avg_price_sqm"),
        )
        .filter(Listing.city.ilike(f"%{city}%"), Listing.price_per_sqm.isnot(None))
        .group_by(Listing.zone, Listing.condition)
        .all()
    )

    zones: dict[str, dict] = {}
    for zone, condition, n, avg_price_sqm in rows:
        z = zones.setdefault(zone or "N/D", {"good_condition": None, "to_renovate": None})
        bucket = "good_condition" if condition in GOOD_CONDITIONS else "to_renovate"
        z[bucket] = {"sample_size": n, "avg_price_sqm": round(avg_price_sqm, 2) if avg_price_sqm else None}

    for zone, data in zones.items():
        good = data.get("good_condition")
        reno = data.get("to_renovate")
        if good and reno and good["avg_price_sqm"] and reno["avg_price_sqm"]:
            data["spread_per_sqm"] = round(good["avg_price_sqm"] - reno["avg_price_sqm"], 2)
        else:
            data["spread_per_sqm"] = None

    return zones
