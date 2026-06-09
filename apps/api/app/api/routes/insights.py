from __future__ import annotations

from fastapi import APIRouter, Query

from app.api.deps import CurrentUser, DbSession
from app.schemas.insights import InsightsSummary
from app.services import insights_service

router = APIRouter(prefix="/api/insights", tags=["insights"])


@router.get("/summary", response_model=InsightsSummary)
async def insights_summary(
    user: CurrentUser,
    db: DbSession,
    range_days: int = Query(default=28, ge=1, le=90),
) -> InsightsSummary:
    """Cross-account hero KPIs + per-account breakdown from real Graph API data (FR-INS-*)."""
    return await insights_service.get_summary(db, user.workspace_id, range_days=range_days)
