import enum
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Condition(str, enum.Enum):
    NUOVO_OTTIMO = "ottimo"
    BUONO = "buono"
    DA_RISTRUTTURARE = "da_ristrutturare"
    GREZZO = "grezzo"
    UNKNOWN = "unknown"


class Portal(str, enum.Enum):
    IMMOBILIARE = "immobiliare.it"
    IDEALISTA = "idealista.it"


class SavedSearch(Base):
    __tablename__ = "saved_searches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    city: Mapped[str] = mapped_column(String(120))
    zone: Mapped[str | None] = mapped_column(String(120), nullable=True)
    min_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_price: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_size_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_size_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    min_rooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_rooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    portals: Mapped[list] = mapped_column(JSON, default=list)  # e.g. ["immobiliare.it", "idealista.it"]
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    runs: Mapped[list["ScrapeRun"]] = relationship(back_populates="search", cascade="all, delete-orphan")


class PropertyCluster(Base):
    """Groups listings from different portals that likely refer to the same
    physical unit, so the UI can show one 'best price' row instead of dupes."""

    __tablename__ = "property_clusters"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)
    approx_size_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    listings: Mapped[list["Listing"]] = relationship(back_populates="cluster")


class Listing(Base):
    __tablename__ = "listings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source: Mapped[str] = mapped_column(String(40), index=True)
    source_id: Mapped[str] = mapped_column(String(120), index=True)
    url: Mapped[str] = mapped_column(String(500))
    title: Mapped[str | None] = mapped_column(String(300), nullable=True)

    price: Mapped[float | None] = mapped_column(Float, nullable=True)
    size_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_per_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)

    rooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    bathrooms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    floor: Mapped[str | None] = mapped_column(String(40), nullable=True)

    city: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    province: Mapped[str | None] = mapped_column(String(80), nullable=True)
    zone: Mapped[str | None] = mapped_column(String(120), nullable=True, index=True)
    address: Mapped[str | None] = mapped_column(String(300), nullable=True)
    lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    lon: Mapped[float | None] = mapped_column(Float, nullable=True)

    condition: Mapped[str] = mapped_column(
        Enum(Condition, native_enum=False), default=Condition.UNKNOWN
    )
    energy_class: Mapped[str | None] = mapped_column(String(10), nullable=True)
    year_built: Mapped[int | None] = mapped_column(Integer, nullable=True)

    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    photos: Mapped[list] = mapped_column(JSON, default=list)
    agency: Mapped[str | None] = mapped_column(String(200), nullable=True)
    raw_data: Mapped[dict] = mapped_column(JSON, default=dict)

    cluster_id: Mapped[int | None] = mapped_column(ForeignKey("property_clusters.id"), nullable=True)
    cluster: Mapped[PropertyCluster | None] = relationship(back_populates="listings")

    first_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)


class RunStatus(str, enum.Enum):
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"


class ScrapeRun(Base):
    __tablename__ = "scrape_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    search_id: Mapped[int] = mapped_column(ForeignKey("saved_searches.id"))
    portal: Mapped[str] = mapped_column(String(40))
    status: Mapped[str] = mapped_column(Enum(RunStatus, native_enum=False), default=RunStatus.RUNNING)
    started_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    listings_found: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)

    search: Mapped[SavedSearch] = relationship(back_populates="runs")
