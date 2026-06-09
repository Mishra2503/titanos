"""initial: workspace, user, audit_log

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-29
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0001_initial"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_ts = lambda: sa.Column(  # noqa: E731
    "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
)


def upgrade() -> None:
    op.create_table(
        "workspace",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("plan", sa.String(), nullable=False, server_default="mvp"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_workspace"),
    )

    op.create_table(
        "user",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=True),
        sa.Column(
            "role",
            sa.Enum("OWNER", "EDITOR", name="role", native_enum=False, length=16),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "ACTIVE", "INVITED", "REVOKED", name="userstatus", native_enum=False, length=16
            ),
            nullable=False,
        ),
        sa.Column("invite_token_hash", sa.String(), nullable=True),
        sa.Column("invite_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], name="fk_user_workspace_id_workspace", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_user"),
        sa.UniqueConstraint("workspace_id", "email", name="uq_user_workspace_email"),
    )
    op.create_index("ix_user_workspace_id", "user", ["workspace_id"])
    op.create_index("ix_user_email", "user", ["email"])

    op.create_table(
        "audit_log",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=True),
        sa.Column("action", sa.String(), nullable=False),
        sa.Column("entity", sa.String(), nullable=True),
        sa.Column("meta_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], name="fk_audit_log_workspace_id_workspace", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["user.id"], name="fk_audit_log_user_id_user", ondelete="SET NULL"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_audit_log"),
    )
    op.create_index("ix_audit_log_workspace_id", "audit_log", ["workspace_id"])


def downgrade() -> None:
    op.drop_table("audit_log")
    op.drop_index("ix_user_email", table_name="user")
    op.drop_index("ix_user_workspace_id", table_name="user")
    op.drop_table("user")
    op.drop_table("workspace")
