from __future__ import annotations

import asyncio
import re
import time
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import decrypt_secret
from app.models.ig_account import IgAccount
from app.schemas.insights import AccountInsights, InsightsSummary, Kpi, RecentPost
from app.services import connection_service, instagram_service
from app.services.instagram_service import InstagramApiError

ACCOUNT_METRICS = ["profile_views"]
# Reels-specific metrics (views, watch time) are dropped by the per-metric fallback
# for non-reel media, so it's safe to request them for everything (FR-INS-6).
MEDIA_METRICS = [
    "reach",
    "likes",
    "comments",
    "shares",
    "saved",
    "total_interactions",
    "views",
    "ig_reels_avg_watch_time",
    "ig_reels_video_view_total_time",
]
MAX_MEDIA = 50
CAPTION_PREVIEW = 280
_HASHTAG_RE = re.compile(r"#\w+", re.UNICODE)


def _hashtags(caption: str | None) -> list[str]:
    return _HASHTAG_RE.findall(caption) if caption else []


def _ms_to_sec(ms: int | None) -> float | None:
    return round(ms / 1000, 1) if isinstance(ms, int) else None

# In-memory TTL cache so the dashboard doesn't hit the Graph API on every page view
# (FR-INS-7). Production uses Redis; this is the single-process dev equivalent.
_CACHE_TTL = 600  # seconds
_cache: dict[str, tuple[float, AccountInsights]] = {}


def _interactions(post: dict[str, int]) -> int | None:
    if "total_interactions" in post:
        return post["total_interactions"]
    parts = [post.get(k) for k in ("likes", "comments", "shares", "saved")]
    known = [p for p in parts if isinstance(p, int)]
    return sum(known) if known else None


async def _build_account_insights(account: IgAccount) -> AccountInsights:
    token = decrypt_secret(account.access_token_enc)

    account_metrics, media_list = await asyncio.gather(
        instagram_service.fetch_account_insights(account.ig_user_id, token, ACCOUNT_METRICS),
        instagram_service.fetch_media_list(account.ig_user_id, token, limit=MAX_MEDIA),
        return_exceptions=True,
    )
    if isinstance(account_metrics, BaseException):
        account_metrics = {}
    if isinstance(media_list, BaseException):
        media_list = []

    async def _post_insights(media: dict) -> tuple[dict, dict[str, int]]:
        try:
            vals = await instagram_service.fetch_media_insights(
                media["id"], token, MEDIA_METRICS
            )
        except InstagramApiError:
            vals = {}
        return media, vals

    pairs = await asyncio.gather(*(_post_insights(m) for m in media_list))

    saves = shares = likes = comments = 0
    interactions_sum = reach_sum = 0
    recent: list[RecentPost] = []
    for media, vals in pairs:
        saves += vals.get("saved", 0)
        shares += vals.get("shares", 0)
        likes += vals.get("likes", 0)
        comments += vals.get("comments", 0)
        inter = _interactions(vals)
        post_reach = vals.get("reach")
        if inter is not None and isinstance(post_reach, int):
            interactions_sum += inter
            reach_sum += post_reach
        post_er = (
            round(inter / post_reach * 100, 1)
            if inter is not None and isinstance(post_reach, int) and post_reach > 0
            else None
        )
        caption = media.get("caption")
        recent.append(
            RecentPost(
                id=media["id"],
                caption=(caption[:CAPTION_PREVIEW] if caption else None),
                permalink=media.get("permalink"),
                thumbnail_url=media.get("thumbnail_url") or media.get("media_url"),
                timestamp=media.get("timestamp"),
                media_product_type=media.get("media_product_type"),
                hashtags=_hashtags(caption),
                reach=post_reach,
                views=vals.get("views"),
                likes=vals.get("likes"),
                comments=vals.get("comments"),
                shares=vals.get("shares"),
                saved=vals.get("saved"),
                avg_watch_time_sec=_ms_to_sec(vals.get("ig_reels_avg_watch_time")),
                total_watch_time_sec=_ms_to_sec(vals.get("ig_reels_video_view_total_time")),
                engagement_rate=post_er,
            )
        )

    engagement_rate = (
        round(interactions_sum / reach_sum * 100, 1) if reach_sum > 0 else None
    )
    # Lead with top performers so "what's working" is obvious at a glance.
    recent.sort(key=lambda p: (p.reach or 0), reverse=True)

    return AccountInsights(
        account_id=account.id,
        username=account.username,
        followers=account.followers_count,
        reach=reach_sum,
        interactions=interactions_sum,
        profile_views=account_metrics.get("profile_views"),
        saves=saves,
        shares=shares,
        likes=likes,
        comments=comments,
        engagement_rate=engagement_rate,
        posts_analyzed=len(media_list),
        recent_posts=recent,
    )


async def _account_insights_cached(account: IgAccount) -> AccountInsights:
    hit = _cache.get(account.id)
    if hit and (time.monotonic() - hit[0]) < _CACHE_TTL:
        return hit[1]
    fresh = await _build_account_insights(account)
    _cache[account.id] = (time.monotonic(), fresh)
    return fresh


async def get_summary(db: AsyncSession, workspace_id: str, *, range_days: int = 28) -> InsightsSummary:
    accounts = await connection_service.list_accounts(db, workspace_id)
    per_account = await asyncio.gather(
        *(_account_insights_cached(a) for a in accounts), return_exceptions=True
    )
    per_account = [a for a in per_account if isinstance(a, AccountInsights)]

    total_reach = sum(a.reach or 0 for a in per_account)
    total_saves = sum(a.saves or 0 for a in per_account)
    total_shares = sum(a.shares or 0 for a in per_account)
    # Honest aggregate: total interactions ÷ total reach, both summed from real per-post data.
    total_inter = sum(a.interactions or 0 for a in per_account)
    er = round(total_inter / total_reach * 100, 1) if total_reach > 0 else None
    has_data = len(per_account) > 0

    kpis = [
        Kpi(
            key="reach",
            label="Reach",
            value=total_reach if has_data else None,
            available=has_data,
            note="Across recent posts" if has_data else None,
        ),
        Kpi(
            key="engagement_rate",
            label="Engagement rate",
            value=er,
            unit="%",
            available=has_data,
            note="Derived: interactions ÷ reach across recent posts" if has_data else None,
        ),
        Kpi(key="saves", label="Saves", value=total_saves if has_data else None, available=has_data),
        Kpi(key="shares", label="Shares", value=total_shares if has_data else None, available=has_data),
        Kpi(
            key="dm_leads",
            label="DM leads",
            available=False,
            note="Connect GoHighLevel to populate the lead funnel",
        ),
        Kpi(
            key="calls_booked",
            label="Calls booked",
            available=False,
            note="Connect GoHighLevel to populate the lead funnel",
        ),
    ]

    return InsightsSummary(
        generated_at=datetime.now(UTC),
        range_days=range_days,
        kpis=kpis,
        accounts=per_account,
    )
