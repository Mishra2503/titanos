"""In-process publisher driver using APScheduler.

For local dev / single-instance prod this runs inside the FastAPI process every
PUBLISHER_TICK_SECONDS and calls publisher_service.tick(). Swap for Celery beat
+ Redis once we go multi-instance.
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.core.config import settings
from app.services import publisher_service

log = logging.getLogger("titan.publisher")
_scheduler: AsyncIOScheduler | None = None


async def _safe_tick() -> None:
    try:
        result = await publisher_service.tick()
        if any(result.get(k, 0) for k in ("published", "failed", "due")):
            log.info("publisher tick: %s", result)
    except Exception:
        log.exception("publisher tick crashed (will retry next interval)")


def start() -> None:
    global _scheduler
    if _scheduler is not None:
        return
    _scheduler = AsyncIOScheduler(timezone="UTC")
    _scheduler.add_job(
        _safe_tick,
        "interval",
        seconds=settings.publisher_tick_seconds,
        id="publisher_tick",
        max_instances=1,
        coalesce=True,
    )
    _scheduler.start()
    log.info("publisher started (tick every %ss)", settings.publisher_tick_seconds)


async def stop() -> None:
    global _scheduler
    if _scheduler is not None:
        _scheduler.shutdown(wait=False)
        _scheduler = None
