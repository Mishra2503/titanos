from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base, TimestampMixin, UUIDMixin

if TYPE_CHECKING:
    from app.models.competitor import Competitor


class CompetitorReel(UUIDMixin, TimestampMixin, Base):
    """Individual reel or video from a competitor."""

    __tablename__ = "competitor_reel"

    competitor_id: Mapped[str] = mapped_column(
        ForeignKey("competitor.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ig_media_id: Mapped[str] = mapped_column(String(255), index=True, nullable=False)

    media_type: Mapped[str] = mapped_column(String(50), default="REEL")  # REEL, VIDEO, CAROUSEL
    media_url: Mapped[str | None] = mapped_column(Text)           # Video URL (if available)
    thumbnail_url: Mapped[str | None] = mapped_column(Text)

    caption: Mapped[str | None] = mapped_column(Text)
    hashtags: Mapped[list[str] | None] = mapped_column(JSON)      # Extracted hashtags

    # Metrics (populated via API + scraper)
    views: Mapped[int | None] = mapped_column(Integer)
    likes: Mapped[int | None] = mapped_column(Integer)
    comments: Mapped[int | None] = mapped_column(Integer)
    shares: Mapped[int | None] = mapped_column(Integer)           # Estimated or scraped

    engagement_rate: Mapped[float | None] = mapped_column()       # Calculated (likes+comments)/views * 100
    posted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Analysis fields
    is_trending: Mapped[bool] = mapped_column(default=False)
    outlier_score: Mapped[float | None] = mapped_column()         # How much it outperforms average
    ai_insights: Mapped[dict[str, Any] | None] = mapped_column(JSON)

    # Relationship
    competitor: Mapped["Competitor"] = relationship(back_populates="reels")
