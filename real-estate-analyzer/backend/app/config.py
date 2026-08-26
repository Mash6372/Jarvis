"""Central configuration and tunable assumptions.

The renovation-cost and transaction-cost figures below are ballpark Italian
market defaults for a buy-renovate-sell (flip) analysis. They are NOT
authoritative — calibrate them against your own contractor quotes and
notary/agency fees before trusting the deal scores.
"""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_prefix="REA_")

    database_url: str = "sqlite:///./real_estate.db"

    # --- Scraping / anti-abuse ---
    # Minimum delay (seconds) between two requests to the SAME portal.
    # Keep this generous: this is a personal analysis tool, not a crawler.
    min_delay_seconds: float = 6.0
    max_delay_seconds: float = 14.0
    request_timeout_seconds: float = 20.0
    user_agent: str = (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    )
    respect_robots_txt: bool = True
    max_pages_per_search: int = 5

    # --- Renovation cost assumptions (EUR / sqm), by declared condition ---
    reno_cost_per_sqm_ottimo: float = 0.0
    reno_cost_per_sqm_buono: float = 150.0
    reno_cost_per_sqm_da_ristrutturare: float = 550.0
    reno_cost_per_sqm_grezzo: float = 900.0

    # --- Transaction cost assumptions ---
    purchase_tax_rate: float = 0.09        # imposta di registro (seconda casa, indicativa)
    notary_and_agency_buy_rate: float = 0.04
    sale_agency_commission_rate: float = 0.03
    contingency_rate: float = 0.10         # buffer imprevisti su ristrutturazione

    # --- Deal comparables ---
    min_comparables_for_confidence: int = 3
    comparable_radius_km: float = 1.5

    # --- Deduplication across portals ---
    dedup_distance_meters: float = 60.0
    dedup_size_tolerance_pct: float = 0.08


settings = Settings()
