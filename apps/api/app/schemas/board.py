from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field


class CardOut(BaseModel):
    id: str
    column_id: str
    title: str
    notes: str | None = None
    position: float

    emoji: str | None = None
    status: str | None = None
    platforms: list[str] = []
    publish_date: date | None = None
    hook: str | None = None
    visual_hook: str | None = None
    caption: str | None = None
    hashtags: list[str] = []
    reference_url: str | None = None
    raw_footage_url: str | None = None
    cover_image_url: str | None = None

    model_config = {"from_attributes": True}


class ColumnOut(BaseModel):
    id: str
    name: str
    color: str
    position: int
    cards: list[CardOut] = []

    model_config = {"from_attributes": True}


class BoardOut(BaseModel):
    columns: list[ColumnOut]


class ColumnCreate(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    color: str = "slate"


class ColumnUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=60)
    color: str | None = None


class _CardFields(BaseModel):
    """Editable fields shared between create + update."""

    emoji: str | None = None
    status: str | None = None
    platforms: list[str] | None = None
    publish_date: date | None = None
    hook: str | None = None
    visual_hook: str | None = None
    caption: str | None = None
    hashtags: list[str] | None = None
    reference_url: str | None = None
    raw_footage_url: str | None = None
    cover_image_url: str | None = None


class CardCreate(_CardFields):
    column_id: str
    title: str = Field(min_length=1, max_length=280)
    notes: str | None = None


class CardUpdate(_CardFields):
    title: str | None = Field(default=None, min_length=1, max_length=280)
    notes: str | None = None


class ReorderIn(BaseModel):
    card_ids: list[str]


# --- AI assistance ---------------------------------------------------

AiAction = Literal["hooks", "caption", "hashtags", "refine"]


class AiActionIn(BaseModel):
    action: AiAction
    # Optional free-text instruction to steer the model (e.g. "shorter", "more punchy").
    instruction: str | None = None


class AiOut(BaseModel):
    action: AiAction
    text: str
