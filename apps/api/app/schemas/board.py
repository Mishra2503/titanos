from __future__ import annotations

from pydantic import BaseModel, Field


class CardOut(BaseModel):
    id: str
    column_id: str
    title: str
    notes: str | None = None
    position: float

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


class CardCreate(BaseModel):
    column_id: str
    title: str = Field(min_length=1, max_length=280)
    notes: str | None = None


class CardUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=280)
    notes: str | None = None


class ReorderIn(BaseModel):
    card_ids: list[str]
