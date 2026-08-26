from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import analysis, listings, searches
from app.database import init_db
from app.services.scheduler import start_scheduler


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    start_scheduler()
    yield


app = FastAPI(title="Real Estate Flip Analyzer", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten before exposing this beyond localhost
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(searches.router)
app.include_router(listings.router)
app.include_router(analysis.router)


@app.get("/api/health")
def health():
    return {"status": "ok"}
