"""extend board_card with content production fields

Revision ID: 0004_board_card_fields
Revises: 0003_board
Create Date: 2026-05-30
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_board_card_fields"
down_revision: str | None = "0003_board"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("board_card") as batch:
        batch.add_column(sa.Column("emoji", sa.String(), nullable=True))
        batch.add_column(sa.Column("status", sa.String(), nullable=True))
        batch.add_column(sa.Column("platforms", sa.JSON(), nullable=False, server_default="[]"))
        batch.add_column(sa.Column("publish_date", sa.Date(), nullable=True))
        batch.add_column(sa.Column("hook", sa.String(), nullable=True))
        batch.add_column(sa.Column("visual_hook", sa.String(), nullable=True))
        batch.add_column(sa.Column("caption", sa.String(), nullable=True))
        batch.add_column(sa.Column("hashtags", sa.JSON(), nullable=False, server_default="[]"))
        batch.add_column(sa.Column("reference_url", sa.String(), nullable=True))
        batch.add_column(sa.Column("raw_footage_url", sa.String(), nullable=True))
        batch.add_column(sa.Column("cover_image_url", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("board_card") as batch:
        for col in (
            "cover_image_url",
            "raw_footage_url",
            "reference_url",
            "hashtags",
            "caption",
            "visual_hook",
            "hook",
            "publish_date",
            "platforms",
            "status",
            "emoji",
        ):
            batch.drop_column(col)
