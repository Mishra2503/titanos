"""Make all business datetime columns tz-aware (TIMESTAMPTZ on Postgres).

Without this, Postgres rejects writes/reads of tz-aware Python datetimes against
the columns. SQLite happily ignored the difference, which is how the bug got past
local tests.

Revision ID: 0006_tz_aware_datetimes
Revises: 0005_scheduling
Create Date: 2026-06-02
"""
from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0006_tz_aware_datetimes"
down_revision: str | None = "0005_scheduling"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# All columns that store wall-clock business moments and should be TIMESTAMPTZ.
# (created_at/updated_at on every table are already tz-aware via TimestampMixin.)
_TZ_COLUMNS = [
    ('"user"', "invite_expires_at"),
    ("ig_account", "token_expires_at"),
    ("ig_account", "last_synced_at"),
    ("scheduled_post", "scheduled_at"),
    ("scheduled_post", "processing_started_at"),
    ("scheduled_post", "published_at"),
]


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        # SQLite has no real timezone enforcement and tests rebuild schema from
        # the ORM metadata; nothing to do here for non-PG backends.
        return
    for table, column in _TZ_COLUMNS:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} "
            f"TYPE TIMESTAMP WITH TIME ZONE "
            f"USING {column} AT TIME ZONE 'UTC'"
        )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table, column in _TZ_COLUMNS:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN {column} "
            f"TYPE TIMESTAMP WITHOUT TIME ZONE "
            f"USING {column} AT TIME ZONE 'UTC'"
        )
