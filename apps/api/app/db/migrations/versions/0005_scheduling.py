"""scheduling: media_asset, campaign, scheduled_post

Revision ID: 0005_scheduling
Revises: 0004_board_card_fields
Create Date: 2026-05-31
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0005_scheduling"
down_revision: str | None = "0004_board_card_fields"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "media_asset",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("filename", sa.String(), nullable=False),
        sa.Column("cloudinary_public_id", sa.String(), nullable=True),
        sa.Column("public_url", sa.String(), nullable=False),
        sa.Column("width", sa.Integer(), nullable=True),
        sa.Column("height", sa.Integer(), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.Column("format", sa.String(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("uploaded_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], name="fk_media_asset_workspace_id_workspace", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by"], ["user.id"], name="fk_media_asset_uploaded_by_user", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_media_asset"),
    )
    op.create_index("ix_media_asset_workspace_id", "media_asset", ["workspace_id"])

    op.create_table(
        "campaign",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("media_asset_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=True),
        sa.Column(
            "status",
            sa.Enum("DRAFT", "APPROVED", "PARTIALLY_PUBLISHED", "DONE", name="campaignstatus", native_enum=False, length=24),
            nullable=False,
        ),
        sa.Column("created_by", sa.String(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], name="fk_campaign_workspace_id_workspace", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["media_asset_id"], ["media_asset.id"], name="fk_campaign_media_asset_id_media_asset", ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(["created_by"], ["user.id"], name="fk_campaign_created_by_user", ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id", name="pk_campaign"),
    )
    op.create_index("ix_campaign_workspace_id", "campaign", ["workspace_id"])

    op.create_table(
        "scheduled_post",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("campaign_id", sa.String(), nullable=False),
        sa.Column("ig_account_id", sa.String(), nullable=False),
        sa.Column("caption", sa.String(), nullable=False),
        sa.Column("hashtags", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "SCHEDULED", "PROCESSING", "PUBLISHED", "FAILED", "CANCELED",
                name="scheduledpoststatus", native_enum=False, length=16,
            ),
            nullable=False,
        ),
        sa.Column("container_id", sa.String(), nullable=True),
        sa.Column("published_media_id", sa.String(), nullable=True),
        sa.Column("permalink", sa.String(), nullable=True),
        sa.Column("error", sa.String(length=2000), nullable=True),
        sa.Column("idempotency_key", sa.String(), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("processing_started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspace.id"], name="fk_scheduled_post_workspace_id_workspace", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaign.id"], name="fk_scheduled_post_campaign_id_campaign", ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["ig_account_id"], ["ig_account.id"], name="fk_scheduled_post_ig_account_id_ig_account", ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name="pk_scheduled_post"),
        sa.UniqueConstraint("idempotency_key", name="uq_scheduled_post_idempotency_key"),
    )
    op.create_index("ix_scheduled_post_workspace_id", "scheduled_post", ["workspace_id"])
    op.create_index("ix_scheduled_post_campaign_id", "scheduled_post", ["campaign_id"])
    op.create_index("ix_scheduled_post_ig_account_id", "scheduled_post", ["ig_account_id"])
    op.create_index("ix_scheduled_post_scheduled_at", "scheduled_post", ["scheduled_at"])
    op.create_index("ix_scheduled_post_status", "scheduled_post", ["status"])


def downgrade() -> None:
    op.drop_table("scheduled_post")
    op.drop_index("ix_campaign_workspace_id", table_name="campaign")
    op.drop_table("campaign")
    op.drop_index("ix_media_asset_workspace_id", table_name="media_asset")
    op.drop_table("media_asset")
