from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import SavedSearch
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
