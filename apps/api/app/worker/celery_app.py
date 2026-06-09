from __future__ import annotations

from celery import Celery

from app.core.config import settings

# Worker process (PRD §8): scheduled publishing, token refresh, insights sync,
# anomaly checks. Tasks land here in later phases; must stay idempotent (Rail #5).
celery_app = Celery(
    "titan",
    broker=settings.redis_url,
    backend=settings.redis_url,
)
celery_app.conf.update(
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    beat_schedule={
        "refresh-expiring-tokens": {
            "task": "titan.refresh_expiring_tokens",
            "schedule": 6 * 60 * 60,  # every 6 hours
        },
    },
)

# Import tasks so the worker registers them.
celery_app.autodiscover_tasks(["app.worker"])


@celery_app.task(name="titan.ping")
def ping() -> str:
    return "pong"
