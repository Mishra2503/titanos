from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.models.enums import CampaignStatus, ScheduledPostStatus


class MediaAssetOut(BaseModel):
    id: str
    filename: str
    public_url: str
    width: int | None = None
    height: int | None = None
    duration_s: float | None = None
    format: str | None = None
    size_bytes: int | None = None

    model_config = {"from_attributes": True}


class ScheduledPostRowIn(BaseModel):
    ig_account_id: str
    caption: str = Field(min_length=1, max_length=2200)
    hashtags: list[str] = []
    scheduled_at: datetime


class CampaignCreate(BaseModel):
    media_asset_id: str
    title: str | None = None
    posts: list[ScheduledPostRowIn] = Field(min_length=1)


class ScheduledPostUpdate(BaseModel):
    caption: str | None = Field(default=None, min_length=1, max_length=2200)
    hashtags: list[str] | None = None
    scheduled_at: datetime | None = None


class ScheduledPostOut(BaseModel):
    id: str
    campaign_id: str
    ig_account_id: str
    caption: str
    hashtags: list[str]
    scheduled_at: datetime
    status: ScheduledPostStatus
    container_id: str | None = None
    published_media_id: str | None = None
    permalink: str | None = None
    error: str | None = None
    attempts: int
    published_at: datetime | None = None

    model_config = {"from_attributes": True}


class CampaignOut(BaseModel):
    id: str
    title: str | None = None
    status: CampaignStatus
    media: MediaAssetOut
    posts: list[ScheduledPostOut]
    created_at: datetime

    model_config = {"from_attributes": True}


class ScheduleListItem(BaseModel):
    """Flat row for the Queue/Calendar view (PRD §7.4 sub-flow D)."""

    id: str
    campaign_id: str
    ig_account_id: str
    ig_username: str
    caption: str
    hashtags: list[str]
    scheduled_at: datetime
    status: ScheduledPostStatus
    permalink: str | None = None
    error: str | None = None
    attempts: int
    thumbnail_url: str | None = None
