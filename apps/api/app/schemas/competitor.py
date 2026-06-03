from __future__ import annotations

from datetime import date

from pydantic import BaseModel, Field, field_validator

from app.schemas._types import UtcDatetime


# --- inputs -------------------------------------------------------

class CompetitorCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    display_name: str | None = Field(default=None, max_length=120)
    category: str | None = Field(default=None, max_length=80)
    profile_url: str | None = None
    notes: str | None = None

    @field_validator("username")
    @classmethod
    def _normalize(cls, v: str) -> str:
        return v.strip().lstrip("@")


class CompetitorUpdate(BaseModel):
    display_name: str | None = None
    category: str | None = None
    profile_url: str | None = None
    avatar_url: str | None = None
    notes: str | None = None


class SnapshotCreate(BaseModel):
    captured_on: date | None = None
    followers_count: int | None = Field(default=None, ge=0)
    following_count: int | None = Field(default=None, ge=0)
    posts_count: int | None = Field(default=None, ge=0)
    avg_likes: int | None = Field(default=None, ge=0)
    avg_comments: int | None = Field(default=None, ge=0)
    engagement_rate: float | None = Field(default=None, ge=0)
    note: str | None = None


class PostCreate(BaseModel):
    permalink: str | None = None
    post_type: str | None = Field(default=None, max_length=24)
    caption: str | None = None
    # If omitted, the server parses #tags from the caption.
    hashtags: list[str] | None = None
    likes: int | None = Field(default=None, ge=0)
    comments: int | None = Field(default=None, ge=0)
    views: int | None = Field(default=None, ge=0)
    posted_on: date | None = None
    thumbnail_url: str | None = None
    what_works: str | None = None


# --- outputs ------------------------------------------------------

class SnapshotOut(BaseModel):
    id: str
    captured_on: date
    followers_count: int | None
    following_count: int | None
    posts_count: int | None
    avg_likes: int | None
    avg_comments: int | None
    engagement_rate: float | None
    note: str | None

    model_config = {"from_attributes": True}


class PostOut(BaseModel):
    id: str
    permalink: str | None
    post_type: str | None
    caption: str | None
    hashtags: list[str]
    likes: int | None
    comments: int | None
    views: int | None
    posted_on: date | None
    thumbnail_url: str | None
    what_works: str | None
    engagement: int | None = None  # likes + comments (only public signals)

    model_config = {"from_attributes": True}


class HashtagStat(BaseModel):
    tag: str
    count: int
    avg_engagement: float | None


class CompetitorAnalytics(BaseModel):
    latest_followers: int | None
    follower_delta: int | None
    follower_delta_pct: float | None
    growth_since: date | None
    avg_engagement_rate: float | None
    posts_per_week: float | None
    content_mix: dict[str, int]
    top_hashtags: list[HashtagStat]
    top_posts: list[PostOut]


class ReportOut(BaseModel):
    id: str
    competitor_id: str | None
    title: str
    content: str
    model: str | None
    generated_at: UtcDatetime

    model_config = {"from_attributes": True, "protected_namespaces": ()}


class CompetitorListItem(BaseModel):
    id: str
    username: str
    display_name: str | None
    category: str | None
    profile_url: str | None
    avatar_url: str | None
    latest_followers: int | None
    avg_engagement_rate: float | None
    follower_delta: int | None
    follower_delta_pct: float | None
    snapshot_count: int
    post_count: int
    report_count: int


class CompetitorDetail(BaseModel):
    id: str
    username: str
    display_name: str | None
    category: str | None
    profile_url: str | None
    avatar_url: str | None
    notes: str | None
    snapshots: list[SnapshotOut]
    posts: list[PostOut]
    analytics: CompetitorAnalytics
    reports: list[ReportOut]
