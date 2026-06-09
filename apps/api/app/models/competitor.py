"""Competitor intelligence (manual tracker + AI report).

Rail #1/#2: no scraping and no fabricated analytics. Every metric stored here is
entered by the user (or, later, fetched from Meta's official Business Discovery for
PUBLIC fields only). Private competitor metrics (reach/impressions/saves) are never
available and are never invented.
"""
from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import JSON, Date, DateTime
from sqlalchemy import Float, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin


class Competitor(UUIDMixin, TimestampMixin, Base):
    """A competitor account the workspace is tracking."""

    __tablename__ = "competitor"
    __table_args__ = (
        UniqueConstraint("workspace_id", "username", name="uq_competitor_workspace_username"),
    )

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    username: Mapped[str] = mapped_column(String(64), nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120), nullable=True)
    category: Mapped[str | None] = mapped_column(String(80), nullable=True)
    profile_url: Mapped[str | None] = mapped_column(nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(nullable=True)
    # Free-form running notes on their positioning / content pillars / strategy.
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )


class CompetitorSnapshot(UUIDMixin, TimestampMixin, Base):
    """A point-in-time observation of a competitor's public counts. Drives growth charts."""

    __tablename__ = "competitor_snapshot"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    competitor_id: Mapped[str] = mapped_column(
        ForeignKey("competitor.id", ondelete="CASCADE"), index=True, nullable=False
    )
    captured_on: Mapped[date] = mapped_column(Date, index=True, nullable=False)
    followers_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    following_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    posts_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_likes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    avg_comments: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Optional explicit engagement rate; otherwise derived from avg_likes+comments/followers.
    engagement_rate: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)


class CompetitorPost(UUIDMixin, TimestampMixin, Base):
    """A saved reference post (swipe file) from a competitor — the raw material for
    hashtag-frequency, content-mix and top-post analysis."""

    __tablename__ = "competitor_post"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    competitor_id: Mapped[str] = mapped_column(
        ForeignKey("competitor.id", ondelete="CASCADE"), index=True, nullable=False
    )
    permalink: Mapped[str | None] = mapped_column(nullable=True)
    # REEL | CAROUSEL | IMAGE | STORY (free string, validated in schema).
    post_type: Mapped[str | None] = mapped_column(String(24), nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)
    hashtags: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    likes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    comments: Mapped[int | None] = mapped_column(Integer, nullable=True)
    views: Mapped[int | None] = mapped_column(Integer, nullable=True)
    posted_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    thumbnail_url: Mapped[str | None] = mapped_column(nullable=True)
    # Why this post worked — the strategic takeaway to replicate.
    what_works: Mapped[str | None] = mapped_column(Text, nullable=True)


class CompetitorReport(UUIDMixin, TimestampMixin, Base):
    """A saved AI-generated analysis. competitor_id is null for a cross-competitor report."""

    __tablename__ = "competitor_report"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    competitor_id: Mapped[str | None] = mapped_column(
        ForeignKey("competitor.id", ondelete="CASCADE"), index=True, nullable=True
    )
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(String(80), nullable=True)
    generated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    created_by: Mapped[str | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
