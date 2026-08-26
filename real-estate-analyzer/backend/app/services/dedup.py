"""Cross-portal deduplication.

The same physical apartment is often listed on both immobiliare.it and
idealista.it (sometimes at different prices, or by different agencies). We
cluster listings that are very likely the same unit using coordinates +
size, since titles/descriptions are unreliable for matching.
"""
from __future__ import annotations

import math

from sqlalchemy.orm import Session

from app.config import settings
from app.models import Listing, PropertyCluster


def _haversine_meters(lat1, lon1, lat2, lon2) -> float:
    r = 6_371_000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlambda / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def assign_cluster(db: Session, listing: Listing) -> None:
    """Attach `listing` to an existing PropertyCluster if a close-enough
    match exists (same rough location + similar size), otherwise create a
    new one. Listings without coordinates are left unclustered."""
    if listing.lat is None or listing.lon is None:
        return

    candidates = (
        db.query(PropertyCluster)
        .filter(
            PropertyCluster.lat.between(listing.lat - 0.01, listing.lat + 0.01),
            PropertyCluster.lon.between(listing.lon - 0.01, listing.lon + 0.01),
        )
        .all()
    )

    for cluster in candidates:
        distance = _haversine_meters(listing.lat, listing.lon, cluster.lat, cluster.lon)
        if distance > settings.dedup_distance_meters:
            continue
        if listing.size_sqm and cluster.approx_size_sqm:
            size_diff_pct = abs(listing.size_sqm - cluster.approx_size_sqm) / cluster.approx_size_sqm
            if size_diff_pct > settings.dedup_size_tolerance_pct:
                continue
        listing.cluster_id = cluster.id
        return

    cluster = PropertyCluster(lat=listing.lat, lon=listing.lon, approx_size_sqm=listing.size_sqm)
    db.add(cluster)
    db.flush()
    listing.cluster_id = cluster.id
