from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SavedSearch, ScrapeRun
from app.schemas import SavedSearchIn, SavedSearchOut
from app.services.scheduler import run_search, scheduler
from datetime import datetime

router = APIRouter(prefix="/api/searches", tags=["searches"])


@router.get("", response_model=list[SavedSearchOut])
def list_searches(db: Session = Depends(get_db)):
    return db.query(SavedSearch).all()


@router.post("", response_model=SavedSearchOut, status_code=201)
def create_search(payload: SavedSearchIn, db: Session = Depends(get_db)):
    search = SavedSearch(**payload.model_dump())
    db.add(search)
    db.commit()
    db.refresh(search)

    if scheduler.running:
        scheduler.add_job(
            run_search,
            "interval",
            hours=6,
            args=[search.id],
            id=f"search-{search.id}",
            replace_existing=True,
        )
    return search


@router.delete("/{search_id}", status_code=204)
def delete_search(search_id: int, db: Session = Depends(get_db)):
    search = db.get(SavedSearch, search_id)
    if not search:
        raise HTTPException(404, "Search not found")
    if scheduler.get_job(f"search-{search_id}"):
        scheduler.remove_job(f"search-{search_id}")
    db.delete(search)
    db.commit()


@router.post("/{search_id}/run-now", status_code=202)
def trigger_search(search_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    search = db.get(SavedSearch, search_id)
    if not search:
        raise HTTPException(404, "Search not found")
    background_tasks.add_task(run_search, search_id)
    return {"status": "scheduled", "triggered_at": datetime.utcnow().isoformat()}


@router.get("/{search_id}/runs")
def list_runs(search_id: int, db: Session = Depends(get_db)):
    """Debug helper: see whether each scrape attempt succeeded, how many
    listings it found, and the error message if it failed (e.g. the portal
    blocked the request or changed its page structure)."""
    search = db.get(SavedSearch, search_id)
    if not search:
        raise HTTPException(404, "Search not found")
    runs = (
        db.query(ScrapeRun)
        .filter(ScrapeRun.search_id == search_id)
        .order_by(ScrapeRun.started_at.desc())
        .all()
    )
    return [
        {
            "id": r.id,
            "portal": r.portal,
            "status": r.status,
            "started_at": r.started_at,
            "finished_at": r.finished_at,
            "listings_found": r.listings_found,
            "error_message": r.error_message,
        }
        for r in runs
    ]
