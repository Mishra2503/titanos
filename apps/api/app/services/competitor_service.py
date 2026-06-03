"""Competitor intelligence: CRUD + honest derived analytics + AI report.

Every number here comes from data the user entered. We derive (never invent):
engagement rate, follower growth, posting cadence, content mix and hashtag frequency.
Private competitor metrics (reach/impressions/saves) are not stored or estimated.
"""
from __future__ import annotations

import re
from collections import Counter, defaultdict
from datetime import UTC, date, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import not_found
from app.models.competitor import (
    Competitor,
    CompetitorPost,
    CompetitorReport,
    CompetitorSnapshot,
)

_HASHTAG_RE = re.compile(r"#(\w+)")


def parse_hashtags(caption: str | None) -> list[str]:
    if not caption:
        return []
    seen: list[str] = []
    for tag in _HASHTAG_RE.findall(caption):
        t = "#" + tag.lower()
        if t not in seen:
            seen.append(t)
    return seen


def _snapshot_engagement(s: CompetitorSnapshot) -> float | None:
    """Engagement rate % for a snapshot: explicit if given, else derived from
    avg likes+comments over followers."""
    if s.engagement_rate is not None:
        return round(s.engagement_rate, 2)
    if s.followers_count and (s.avg_likes is not None or s.avg_comments is not None):
        interactions = (s.avg_likes or 0) + (s.avg_comments or 0)
        return round(interactions / s.followers_count * 100, 2)
    return None


def _post_engagement(p: CompetitorPost) -> int | None:
    if p.likes is None and p.comments is None:
        return None
    return (p.likes or 0) + (p.comments or 0)


# --- competitor CRUD ----------------------------------------------

async def get_competitor(db: AsyncSession, workspace_id: str, competitor_id: str) -> Competitor:
    c = await db.scalar(
        select(Competitor).where(
            Competitor.id == competitor_id, Competitor.workspace_id == workspace_id
        )
    )
    if c is None:
        raise not_found("Competitor not found")
    return c


async def create_competitor(
    db: AsyncSession, workspace_id: str, *, created_by: str, **fields: Any
) -> Competitor:
    c = Competitor(workspace_id=workspace_id, created_by=created_by, **fields)
    db.add(c)
    await db.flush()
    return c


async def update_competitor(
    db: AsyncSession, workspace_id: str, competitor_id: str, **fields: Any
) -> Competitor:
    c = await get_competitor(db, workspace_id, competitor_id)
    for k, v in fields.items():
        if v is not None:
            setattr(c, k, v)
    await db.flush()
    return c


async def delete_competitor(db: AsyncSession, workspace_id: str, competitor_id: str) -> None:
    c = await get_competitor(db, workspace_id, competitor_id)
    await db.delete(c)
    await db.flush()


# --- snapshots & posts --------------------------------------------

async def add_snapshot(
    db: AsyncSession, workspace_id: str, competitor_id: str, *, captured_on: date | None, **fields: Any
) -> CompetitorSnapshot:
    await get_competitor(db, workspace_id, competitor_id)
    snap = CompetitorSnapshot(
        workspace_id=workspace_id,
        competitor_id=competitor_id,
        captured_on=captured_on or datetime.now(UTC).date(),
        **fields,
    )
    db.add(snap)
    await db.flush()
    return snap


async def delete_snapshot(db: AsyncSession, workspace_id: str, snapshot_id: str) -> None:
    snap = await db.scalar(
        select(CompetitorSnapshot).where(
            CompetitorSnapshot.id == snapshot_id,
            CompetitorSnapshot.workspace_id == workspace_id,
        )
    )
    if snap is None:
        raise not_found("Snapshot not found")
    await db.delete(snap)
    await db.flush()


async def add_post(
    db: AsyncSession, workspace_id: str, competitor_id: str, *, caption: str | None,
    hashtags: list[str] | None, **fields: Any
) -> CompetitorPost:
    await get_competitor(db, workspace_id, competitor_id)
    tags = hashtags if hashtags is not None else parse_hashtags(caption)
    tags = [t if t.startswith("#") else "#" + t for t in (tags or [])]
    post = CompetitorPost(
        workspace_id=workspace_id,
        competitor_id=competitor_id,
        caption=caption,
        hashtags=[t.lower() for t in tags],
        **fields,
    )
    db.add(post)
    await db.flush()
    return post


async def delete_post(db: AsyncSession, workspace_id: str, post_id: str) -> None:
    post = await db.scalar(
        select(CompetitorPost).where(
            CompetitorPost.id == post_id, CompetitorPost.workspace_id == workspace_id
        )
    )
    if post is None:
        raise not_found("Post not found")
    await db.delete(post)
    await db.flush()


# --- analytics ----------------------------------------------------

def _avg_engagement_rate(snaps: list[CompetitorSnapshot]) -> float | None:
    rates = [r for r in (_snapshot_engagement(s) for s in snaps) if r is not None]
    return round(sum(rates) / len(rates), 2) if rates else None


def _content_mix(posts: list[CompetitorPost]) -> dict[str, int]:
    return dict(Counter((p.post_type or "OTHER").upper() for p in posts))


def _posts_per_week(posts: list[CompetitorPost]) -> float | None:
    dated = sorted(p.posted_on for p in posts if p.posted_on)
    if len(dated) < 2:
        return None
    span_days = (dated[-1] - dated[0]).days
    weeks = span_days / 7 if span_days > 0 else None
    return round(len(dated) / weeks, 1) if weeks else None


def _top_hashtags(posts: list[CompetitorPost], limit: int = 15) -> list[dict[str, Any]]:
    counts: Counter[str] = Counter()
    eng: dict[str, list[int]] = defaultdict(list)
    for p in posts:
        e = _post_engagement(p)
        for tag in p.hashtags or []:
            counts[tag] += 1
            if e is not None:
                eng[tag].append(e)
    out = []
    for tag, count in counts.most_common(limit):
        vals = eng.get(tag, [])
        out.append(
            {
                "tag": tag,
                "count": count,
                "avg_engagement": round(sum(vals) / len(vals), 1) if vals else None,
            }
        )
    return out


def _post_out(p: CompetitorPost) -> dict[str, Any]:
    return {
        "id": p.id,
        "permalink": p.permalink,
        "post_type": p.post_type,
        "caption": p.caption,
        "hashtags": list(p.hashtags or []),
        "likes": p.likes,
        "comments": p.comments,
        "views": p.views,
        "posted_on": p.posted_on,
        "thumbnail_url": p.thumbnail_url,
        "what_works": p.what_works,
        "engagement": _post_engagement(p),
    }


def _analytics(snaps: list[CompetitorSnapshot], posts: list[CompetitorPost]) -> dict[str, Any]:
    snaps_sorted = sorted(snaps, key=lambda s: s.captured_on)
    latest = snaps_sorted[-1] if snaps_sorted else None
    earliest = snaps_sorted[0] if snaps_sorted else None

    follower_delta = follower_delta_pct = None
    growth_since = None
    if latest and earliest and latest is not earliest:
        if latest.followers_count is not None and earliest.followers_count is not None:
            follower_delta = latest.followers_count - earliest.followers_count
            if earliest.followers_count:
                follower_delta_pct = round(follower_delta / earliest.followers_count * 100, 1)
            growth_since = earliest.captured_on

    ranked = sorted(
        posts,
        key=lambda p: (_post_engagement(p) is not None, _post_engagement(p) or 0),
        reverse=True,
    )
    return {
        "latest_followers": latest.followers_count if latest else None,
        "follower_delta": follower_delta,
        "follower_delta_pct": follower_delta_pct,
        "growth_since": growth_since,
        "avg_engagement_rate": _avg_engagement_rate(snaps),
        "posts_per_week": _posts_per_week(posts),
        "content_mix": _content_mix(posts),
        "top_hashtags": _top_hashtags(posts),
        "top_posts": [_post_out(p) for p in ranked[:6] if _post_engagement(p) is not None],
    }


async def list_competitors(db: AsyncSession, workspace_id: str) -> list[dict[str, Any]]:
    competitors = list(
        await db.scalars(
            select(Competitor)
            .where(Competitor.workspace_id == workspace_id)
            .order_by(Competitor.created_at.asc())
        )
    )
    if not competitors:
        return []

    snaps = list(
        await db.scalars(
            select(CompetitorSnapshot)
            .where(CompetitorSnapshot.workspace_id == workspace_id)
            .order_by(CompetitorSnapshot.captured_on.asc())
        )
    )
    snaps_by_c: dict[str, list[CompetitorSnapshot]] = defaultdict(list)
    for s in snaps:
        snaps_by_c[s.competitor_id].append(s)

    post_counts = dict(
        (
            await db.execute(
                select(CompetitorPost.competitor_id, func.count(CompetitorPost.id))
                .where(CompetitorPost.workspace_id == workspace_id)
                .group_by(CompetitorPost.competitor_id)
            )
        ).all()
    )
    report_counts = dict(
        (
            await db.execute(
                select(CompetitorReport.competitor_id, func.count(CompetitorReport.id))
                .where(
                    CompetitorReport.workspace_id == workspace_id,
                    CompetitorReport.competitor_id.is_not(None),
                )
                .group_by(CompetitorReport.competitor_id)
            )
        ).all()
    )

    out = []
    for c in competitors:
        cs = snaps_by_c.get(c.id, [])
        latest = cs[-1] if cs else None
        prev = cs[-2] if len(cs) >= 2 else None
        delta = delta_pct = None
        if latest and prev and latest.followers_count is not None and prev.followers_count is not None:
            delta = latest.followers_count - prev.followers_count
            if prev.followers_count:
                delta_pct = round(delta / prev.followers_count * 100, 1)
        out.append(
            {
                "id": c.id,
                "username": c.username,
                "display_name": c.display_name,
                "category": c.category,
                "profile_url": c.profile_url,
                "avatar_url": c.avatar_url,
                "latest_followers": latest.followers_count if latest else None,
                "avg_engagement_rate": _avg_engagement_rate(cs),
                "follower_delta": delta,
                "follower_delta_pct": delta_pct,
                "snapshot_count": len(cs),
                "post_count": post_counts.get(c.id, 0),
                "report_count": report_counts.get(c.id, 0),
            }
        )
    return out


async def get_detail(db: AsyncSession, workspace_id: str, competitor_id: str) -> dict[str, Any]:
    c = await get_competitor(db, workspace_id, competitor_id)
    snaps = list(
        await db.scalars(
            select(CompetitorSnapshot)
            .where(CompetitorSnapshot.competitor_id == competitor_id)
            .order_by(CompetitorSnapshot.captured_on.asc())
        )
    )
    posts = list(
        await db.scalars(
            select(CompetitorPost)
            .where(CompetitorPost.competitor_id == competitor_id)
            .order_by(CompetitorPost.posted_on.desc().nullslast(), CompetitorPost.created_at.desc())
        )
    )
    reports = list(
        await db.scalars(
            select(CompetitorReport)
            .where(CompetitorReport.competitor_id == competitor_id)
            .order_by(CompetitorReport.generated_at.desc())
        )
    )
    return {
        "id": c.id,
        "username": c.username,
        "display_name": c.display_name,
        "category": c.category,
        "profile_url": c.profile_url,
        "avatar_url": c.avatar_url,
        "notes": c.notes,
        "snapshots": [
            {
                "id": s.id,
                "captured_on": s.captured_on,
                "followers_count": s.followers_count,
                "following_count": s.following_count,
                "posts_count": s.posts_count,
                "avg_likes": s.avg_likes,
                "avg_comments": s.avg_comments,
                "engagement_rate": _snapshot_engagement(s),
                "note": s.note,
            }
            for s in snaps
        ],
        "posts": [_post_out(p) for p in posts],
        "analytics": _analytics(snaps, posts),
        "reports": reports,
    }
