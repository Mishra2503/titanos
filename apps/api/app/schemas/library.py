from __future__ import annotations

from pydantic import BaseModel

from app.schemas._types import UtcDatetime


class MediaUsage(BaseModel):
    campaigns: int
    scheduled_posts: int
    published_posts: int


class LibraryAssetOut(BaseModel):
    id: str
    filename: str
    public_url: str
    thumbnail_url: str | None = None
    width: int | None = None
    height: int | None = None
    duration_s: float | None = None
    format: str | None = None
    size_bytes: int | None = None
    created_at: UtcDatetime
    uploaded_by_email: str | None = None
    in_use: bool
    usage: MediaUsage
