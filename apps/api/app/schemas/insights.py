from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class Kpi(BaseModel):
    key: str
    label: str
    value: float | int | None = None
    unit: str | None = None
    available: bool = True
    # When a metric isn't sourced yet (e.g. GHL not connected), explain why (FR-INS-6).
    note: str | None = None


class RecentPost(BaseModel):
    id: str
    caption: str | None = None
    permalink: str | None = None
    timestamp: str | None = None
    media_product_type: str | None = None
    reach: int | None = None
    likes: int | None = None
    comments: int | None = None
    shares: int | None = None
    saved: int | None = None


class AccountInsights(BaseModel):
    account_id: str
    username: str
    followers: int | None = None
    # Reach summed across the analyzed recent posts (per-post reach is reliable;
    # account-level 28d reach is flaky for small accounts, so we don't surface it).
    reach: int | None = None
    interactions: int | None = None
    profile_views: int | None = None
    saves: int | None = None
    shares: int | None = None
    likes: int | None = None
    comments: int | None = None
    engagement_rate: float | None = None
    posts_analyzed: int = 0
    recent_posts: list[RecentPost] = []


class InsightsSummary(BaseModel):
    generated_at: datetime
    range_days: int
    kpis: list[Kpi]
    accounts: list[AccountInsights]
