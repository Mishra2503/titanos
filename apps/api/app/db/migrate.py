"""Apply Alembic migrations at startup.

Render (and most hosts) can run `alembic upgrade head` in a build command, but that
is easy to forget and silently leaves new tables missing in prod. Running it on boot
makes schema state self-healing: it is a no-op when already current. Skipped for
non-Postgres (local SQLite manages its schema separately).
"""
from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config

from app.core.config import settings

log = logging.getLogger("titan.migrate")

# app/db/migrate.py -> parents[2] == apps/api (where alembic.ini lives).
_API_ROOT = Path(__file__).resolve().parents[2]


def run_upgrade_head() -> None:
    if "postgres" not in settings.database_url:
        log.info("Auto-migration skipped (non-Postgres database).")
        return
    cfg = Config(str(_API_ROOT / "alembic.ini"))
    cfg.set_main_option("script_location", str(_API_ROOT / "app" / "db" / "migrations"))
    command.upgrade(cfg, "head")
    log.info("Database migrations applied (alembic upgrade head).")
