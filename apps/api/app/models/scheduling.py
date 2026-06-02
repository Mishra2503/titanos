from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, DateTime, Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import CampaignStatus, ScheduledPostStatus


class MediaAsset(UUIDMixin, TimestampMixin, Base):
    """A master video uploaded to Cloudinary (PRD §9 media_asset).

    The `public_url` is the Cloudinary delivery URL that Meta's Graph API downloads
    from during the publish flow (FR-SCHED-2).
    """

    __tablename__ = "media_asset"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    filename: Mapped[str] = mapped_column(nullable=False)
    cloudinary_public_id: Mapped[str | None] = mapped_column(nullable=True)
    public_url: Mapped[str] = mapped_column(nullable=False)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    duration_s: Mapped[float | None] = mapped_column(nullable=True)
    format: Mapped[str | None] = mapped_column(nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    uploaded_by: Mapped[str | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )


class Campaign(UUIDMixin, TimestampMixin, Base):
    """A scheduling batch: one master video distributed across N accounts (PRD §9)."""

    __tablename__ = "campaign"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    media_asset_id: Mapped[str] = mapped_column(
        ForeignKey("media_asset.id", ondelete="RESTRICT"), nullable=False
    )
    title: Mapped[str | None] = mapped_column(nullable=True)
    status: Mapped[CampaignStatus] = mapped_column(
        SAEnum(CampaignStatus, native_enum=False, length=24),
        default=CampaignStatus.APPROVED,
        nullable=False,
    )
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )


class ScheduledPost(UUIDMixin, TimestampMixin, Base):
    """One post in a campaign — a single (account × time × caption) row (PRD §9).

    `idempotency_key` guarantees the publisher worker can crash/restart mid-flight
    without double-posting (Rail #5 / FR-SCHED-12).
    """

    __tablename__ = "scheduled_post"
    __table_args__ = (
        UniqueConstraint("idempotency_key", name="uq_scheduled_post_idempotency_key"),
    )

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    campaign_id: Mapped[str] = mapped_column(
        ForeignKey("campaign.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ig_account_id: Mapped[str] = mapped_column(
        ForeignKey("ig_account.id", ondelete="CASCADE"), index=True, nullable=False
    )
    caption: Mapped[str] = mapped_column(nullable=False)
    hashtags: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    scheduled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )

    status: Mapped[ScheduledPostStatus] = mapped_column(
        SAEnum(ScheduledPostStatus, native_enum=False, length=16),
        default=ScheduledPostStatus.SCHEDULED,
        nullable=False,
        index=True,
    )

    # Meta Graph API state
    container_id: Mapped[str | None] = mapped_column(nullable=True)
    published_media_id: Mapped[str | None] = mapped_column(nullable=True)
    permalink: Mapped[str | None] = mapped_column(nullable=True)

    # Error + reliability
    error: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    idempotency_key: Mapped[str] = mapped_column(nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    processing_started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    published_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
