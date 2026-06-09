from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import select

from app.db.session import SessionLocal
from app.models.enums import IgAccountStatus
from app.models.ig_account import IgAccount
from app.services import connection_service
from app.worker.celery_app import celery_app

# Refresh long-lived tokens this many days before their 60-day expiry (FR-CONN-4).
REFRESH_WINDOW = timedelta(days=10)


async def _refresh_expiring() -> dict[str, int]:
    refreshed = 0
    failed = 0
    cutoff = datetime.now(UTC) + REFRESH_WINDOW
    async with SessionLocal() as db:
        accounts = await db.scalars(
            select(IgAccount).where(
                IgAccount.status == IgAccountStatus.CONNECTED,
                IgAccount.token_expires_at.is_not(None),
                IgAccount.token_expires_at <= cutoff,
            )
        )
        for account in list(accounts):
            try:
                await connection_service.refresh_account(
                    db, workspace_id=account.workspace_id, account_id=account.id
                )
                refreshed += 1
            except Exception:  # noqa: BLE001 — flagged NEEDS_REAUTH inside service
                failed += 1
        await db.commit()
    return {"refreshed": refreshed, "failed": failed}


@celery_app.task(name="titan.refresh_expiring_tokens")
def refresh_expiring_tokens() -> dict[str, int]:
    """Scheduled token-refresh sweep. Idempotent: re-running only refreshes what's near expiry."""
    return asyncio.run(_refresh_expiring())
