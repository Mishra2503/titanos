"""ig_account

Revision ID: 0002_ig_account
Revises: 0001_initial
Create Date: 2026-05-29
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_ig_account"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "ig_account",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("ig_user_id", sa.String(), nullable=False),
        sa.Column("username", sa.String(), nullable=False),
        sa.Column("account_type", sa.String(), nullable=True),
        sa.Column("fb_page_id", sa.String(), nullable=True),
        sa.Column("access_token_enc", sa.String(), nullable=False),
        sa.Column("token_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "CONNECTED",
                "NEEDS_REAUTH",
                "WARMING",
                name="igaccountstatus",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column("followers_count", sa.Integer(), nullable=True),
        sa.Column("last_synced_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"],
            ["workspace.id"],
            name="fk_ig_account_workspace_id_workspace",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name="pk_ig_account"),
        sa.UniqueConstraint("workspace_id", "ig_user_id", name="uq_ig_account_workspace_iguser"),
    )
    op.create_index("ix_ig_account_workspace_id", "ig_account", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_ig_account_workspace_id", table_name="ig_account")
    op.drop_table("ig_account")
