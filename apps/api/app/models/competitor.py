from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import CompetitorStatus

if TYPE_CHECKING:
    from app.models.workspace import Workspace
    from app.models.competitor_reel import CompetitorReel
    from app.models.competitor_snapshot import CompetitorSnapshot


class Competitor(UUIDMixin, TimestampMixin, Base):
    """A competitor Instagram professional account being tracked."""

    __tablename__ = "competitor"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ig_username: Mapped[str] = mapped_column(String(255), index=True, nullable=False)
    ig_user_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)

    # Profile data from Business Discovery
    profile_picture_url: Mapped[str | None] = mapped_column(Text)
    biography: Mapped[str | None] = mapped_column(Text)
    website: Mapped[str | None] = mapped_column(String(512))
    follower_count: Mapped[int | None] = mapped_column(Integer)
    media_count: Mapped[int | None] = mapped_column(Integer)

    status: Mapped[CompetitorStatus] = mapped_column(
        default=CompetitorStatus.ACTIVE, nullable=False
    )
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Relationships
    workspace: Mapped["Workspace"] = relationship(back_populates="competitors")
    reels: Mapped[list["CompetitorReel"]] = relationship(
        back_populates="competitor", cascade="all, delete-orphan"
    )
    snapshots: Mapped[list["CompetitorSnapshot"]] = relationship(
        back_populates="competitor", cascade="all, delete-orphan"
    )
