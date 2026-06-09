from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession
from app.core.config import settings
from app.models.ig_account import IgAccount
from app.schemas._types import UtcDatetime
from app.services import safety_service

router = APIRouter(prefix="/api/safety", tags=["safety"])


class SafetyDefaults(BaseModel):
    enabled: bool
    daily_cap: int
    hourly_cap: int
    min_gap_minutes: int
    jitter_seconds: int


class AccountHealthOut(BaseModel):
    ig_account_id: str
    username: str
    level: Literal["GREEN", "YELLOW", "RED"]
    posts_24h: int
    posts_7d: int
    last_published_at: UtcDatetime | None = None
    next_safe_post_at: UtcDatetime | None = None
    reasons: list[str]


class SafetyOverview(BaseModel):
    defaults: SafetyDefaults
    accounts: list[AccountHealthOut]


@router.get("/health", response_model=SafetyOverview)
async def safety_health(user: CurrentUser, db: DbSession) -> SafetyOverview:
    accounts = list(
        await db.scalars(
            select(IgAccount).where(IgAccount.workspace_id == user.workspace_id)
        )
    )
    health = []
    for a in accounts:
        h = await safety_service.compute_account_health(db, a.id, a.username)
        health.append(AccountHealthOut(**h.__dict__))
    return SafetyOverview(
        defaults=SafetyDefaults(
            enabled=settings.safety_enabled,
            daily_cap=settings.safety_daily_cap,
            hourly_cap=settings.safety_hourly_cap,
            min_gap_minutes=settings.safety_min_gap_minutes,
            jitter_seconds=settings.safety_jitter_seconds,
        ),
        accounts=health,
    )
