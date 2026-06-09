from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import JSON, Date, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin


class BoardColumn(UUIDMixin, TimestampMixin, Base):
    """A stage in the content pipeline Kanban (e.g. Ideas, Editing, Scheduled)."""

    __tablename__ = "board_column"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(nullable=False)
    color: Mapped[str] = mapped_column(default="slate", nullable=False)
    position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)


class BoardCard(UUIDMixin, TimestampMixin, Base):
    """A content idea/draft card living in a board column."""

    __tablename__ = "board_card"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    column_id: Mapped[str] = mapped_column(
        ForeignKey("board_column.id", ondelete="CASCADE"), index=True, nullable=False
    )
    title: Mapped[str] = mapped_column(nullable=False)
    notes: Mapped[str | None] = mapped_column(nullable=True)
    # Float ordering so cards can be re-sequenced without renumbering siblings.
    position: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)

    # --- Content production fields (Notion-style card detail) ---
    emoji: Mapped[str | None] = mapped_column(nullable=True)
    # Free-text status label (e.g. "Idea", "Ready to record", "Filming"). Column-level
    # status comes from which column the card lives in; this is finer-grained.
    status: Mapped[str | None] = mapped_column(nullable=True)
    # Distribution targets (e.g. ["Instagram", "YouTube Shorts"]).
    platforms: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    publish_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    # The opening line of the script (most important sentence). Separate from notes.
    hook: Mapped[str | None] = mapped_column(nullable=True)
    # Visual concept description for the reel.
    visual_hook: Mapped[str | None] = mapped_column(nullable=True)
    caption: Mapped[str | None] = mapped_column(nullable=True)
    hashtags: Mapped[list[Any]] = mapped_column(JSON, default=list, nullable=False)
    reference_url: Mapped[str | None] = mapped_column(nullable=True)
    raw_footage_url: Mapped[str | None] = mapped_column(nullable=True)
    cover_image_url: Mapped[str | None] = mapped_column(nullable=True)
