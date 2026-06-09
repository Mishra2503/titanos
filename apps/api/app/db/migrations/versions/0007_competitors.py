"""competitors: competitor, competitor_snapshot, competitor_post, competitor_report

Revision ID: 0007_competitors
Revises: 0006_tz_aware_datetimes
Create Date: 2026-06-03
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_competitors"
down_revision: str | None = "0006_tz_aware_datetimes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "competitor",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("display_name", sa.String(length=120), nullable=True),
        sa.Column("category", sa.String(length=80), nullable=True),
        sa.Column("profile_url", sa.String(), nullable=True),
        sa.Column("avatar_url", sa.String(), nullable=True),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], name="fk_competitor_workspace_id_workspace", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["user.id"], name="fk_competitor_created_by_user", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_competitor"),
        sa.UniqueConstraint("workspace_id", "username", name="uq_competitor_workspace_username"),
    )
    op.create_index("ix_competitor_workspace_id", "competitor", ["workspace_id"])

    op.create_table(
        "competitor_snapshot",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("competitor_id", sa.String(), nullable=False),
        sa.Column("captured_on", sa.Date(), nullable=False),
        sa.Column("followers_count", sa.Integer(), nullable=True),
        sa.Column("following_count", sa.Integer(), nullable=True),
        sa.Column("posts_count", sa.Integer(), nullable=True),
        sa.Column("avg_likes", sa.Integer(), nullable=True),
        sa.Column("avg_comments", sa.Integer(), nullable=True),
        sa.Column("engagement_rate", sa.Float(), nullable=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], name="fk_competitor_snapshot_workspace_id_workspace", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["competitor_id"], ["competitor.id"], name="fk_competitor_snapshot_competitor_id_competitor", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_competitor_snapshot"),
    )
    op.create_index("ix_competitor_snapshot_workspace_id", "competitor_snapshot", ["workspace_id"])
    op.create_index("ix_competitor_snapshot_competitor_id", "competitor_snapshot", ["competitor_id"])
    op.create_index("ix_competitor_snapshot_captured_on", "competitor_snapshot", ["captured_on"])

    op.create_table(
        "competitor_post",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("competitor_id", sa.String(), nullable=False),
        sa.Column("permalink", sa.String(), nullable=True),
        sa.Column("post_type", sa.String(length=24), nullable=True),
        sa.Column("caption", sa.Text(), nullable=True),
        sa.Column("hashtags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("likes", sa.Integer(), nullable=True),
        sa.Column("comments", sa.Integer(), nullable=True),
        sa.Column("views", sa.Integer(), nullable=True),
        sa.Column("posted_on", sa.Date(), nullable=True),
        sa.Column("thumbnail_url", sa.String(), nullable=True),
        sa.Column("what_works", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], name="fk_competitor_post_workspace_id_workspace", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["competitor_id"], ["competitor.id"], name="fk_competitor_post_competitor_id_competitor", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_competitor_post"),
    )
    op.create_index("ix_competitor_post_workspace_id", "competitor_post", ["workspace_id"])
    op.create_index("ix_competitor_post_competitor_id", "competitor_post", ["competitor_id"])

    op.create_table(
        "competitor_report",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("competitor_id", sa.String(), nullable=True),
        sa.Column("title", sa.String(length=200), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=80), nullable=True),
        sa.Column("generated_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], name="fk_competitor_report_workspace_id_workspace", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["competitor_id"], ["competitor.id"], name="fk_competitor_report_competitor_id_competitor", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by"], ["user.id"], name="fk_competitor_report_created_by_user", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_competitor_report"),
    )
    op.create_index("ix_competitor_report_workspace_id", "competitor_report", ["workspace_id"])
    op.create_index("ix_competitor_report_competitor_id", "competitor_report", ["competitor_id"])


def downgrade() -> None:
    op.drop_table("competitor_report")
    op.drop_table("competitor_post")
    op.drop_table("competitor_snapshot")
    op.drop_table("competitor")
