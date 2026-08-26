"""Buy-renovate-sell (flip) deal analysis.

For a candidate listing (typically 'da_ristrutturare' / needs work), we:
  1. Find comparable listings in the same zone that are already in
     good/excellent condition, to estimate the After-Renovation-Value (ARV)
     per sqm.
  2. Estimate renovation cost from the declared condition (config defaults,
     calibrate against real contractor quotes).
  3. Estimate transaction costs (purchase taxes/notary + resale agency fee).
  4. Compute expected margin, ROI and a 0-100 deal_score used to rank
     listings in the UI.

This is a heuristic model, not a valuation — always sanity-check a
shortlisted deal manually (real comparables, real renovation quotes, actual
zone dynamics) before offering.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Condition, Listing

GOOD_CONDITIONS = (Condition.NUOVO_OTTIMO.value, Condition.BUONO.value)

RENO_COST_BY_CONDITION = {
    Condition.NUOVO_OTTIMO.value: settings.reno_cost_per_sqm_ottimo,
    Condition.BUONO.value: settings.reno_cost_per_sqm_buono,
    Condition.DA_RISTRUTTURARE.value: settings.reno_cost_per_sqm_da_ristrutturare,
    Condition.GREZZO.value: settings.reno_cost_per_sqm_grezzo,
    Condition.UNKNOWN.value: settings.reno_cost_per_sqm_da_ristrutturare,
}


@dataclass
class DealResult:
    zone_avg_price_sqm_good_condition: float | None
    comparables_sample_size: int
    confidence: str
    estimated_after_reno_value: float | None
    estimated_renovation_cost: float | None
    estimated_transaction_costs: float | None
    estimated_total_investment: float | None
    estimated_margin: float | None
    estimated_roi_pct: float | None
    deal_score: float | None
    notes: list[str]


def _zone_comparables(db: Session, listing: Listing) -> list[Listing]:
    if not listing.zone and not listing.city:
        return []
    query = db.query(Listing).filter(
        Listing.condition.in_(GOOD_CONDITIONS),
        Listing.price_per_sqm.isnot(None),
        Listing.id != listing.id,
    )
    if listing.zone:
        query = query.filter(Listing.zone == listing.zone)
    else:
        query = query.filter(Listing.city == listing.city)
    return query.all()


def analyze_deal(db: Session, listing: Listing) -> DealResult:
    notes: list[str] = []

    if not listing.price or not listing.size_sqm:
        return DealResult(None, 0, "low", None, None, None, None, None, None, None, [
            "Prezzo o superficie mancanti: impossibile calcolare."
        ])

    comparables = _zone_comparables(db, listing)
    sample_size = len(comparables)

    if sample_size == 0:
        confidence = "low"
        zone_avg = None
        notes.append("Nessun comparabile trovato nella stessa zona: stima non affidabile.")
    else:
        prices_per_sqm = [c.price_per_sqm for c in comparables]
        zone_avg = statistics.median(prices_per_sqm)
        if sample_size >= settings.min_comparables_for_confidence * 2:
            confidence = "high"
        elif sample_size >= settings.min_comparables_for_confidence:
            confidence = "medium"
        else:
            confidence = "low"
            notes.append(f"Solo {sample_size} comparabili trovati: stima poco affidabile.")

    condition = listing.condition if isinstance(listing.condition, str) else listing.condition.value
    reno_cost_per_sqm = RENO_COST_BY_CONDITION.get(condition, settings.reno_cost_per_sqm_da_ristrutturare)
    estimated_renovation_cost = reno_cost_per_sqm * listing.size_sqm * (1 + settings.contingency_rate)

    estimated_after_reno_value = zone_avg * listing.size_sqm if zone_avg else None

    purchase_side_costs = listing.price * (settings.purchase_tax_rate + settings.notary_and_agency_buy_rate)
    sale_side_costs = (estimated_after_reno_value or 0) * settings.sale_agency_commission_rate
    estimated_transaction_costs = purchase_side_costs + sale_side_costs

    estimated_total_investment = listing.price + estimated_renovation_cost + purchase_side_costs

    if estimated_after_reno_value is None:
        estimated_margin = None
        estimated_roi_pct = None
        deal_score = None
    else:
        estimated_margin = estimated_after_reno_value - estimated_total_investment - sale_side_costs
        estimated_roi_pct = (estimated_margin / estimated_total_investment) * 100 if estimated_total_investment else None
        deal_score = _score(estimated_roi_pct, confidence)

    return DealResult(
        zone_avg_price_sqm_good_condition=zone_avg,
        comparables_sample_size=sample_size,
        confidence=confidence,
        estimated_after_reno_value=estimated_after_reno_value,
        estimated_renovation_cost=estimated_renovation_cost,
        estimated_transaction_costs=estimated_transaction_costs,
        estimated_total_investment=estimated_total_investment,
        estimated_margin=estimated_margin,
        estimated_roi_pct=estimated_roi_pct,
        deal_score=deal_score,
        notes=notes,
    )


def _score(roi_pct: float | None, confidence: str) -> float:
    """Map ROI% into a 0-100 score, discounted when comparable confidence is
    low so shaky estimates don't outrank well-supported ones."""
    if roi_pct is None:
        return 0.0
    # 0% ROI -> 0, 30%+ ROI -> 100, linear in between, clamped.
    raw = max(0.0, min(100.0, (roi_pct / 30.0) * 100.0))
    confidence_multiplier = {"high": 1.0, "medium": 0.85, "low": 0.6}[confidence]
    return round(raw * confidence_multiplier, 1)


def recompute_price_per_sqm(listing: Listing) -> None:
    if listing.price and listing.size_sqm:
        listing.price_per_sqm = round(listing.price / listing.size_sqm, 2)
