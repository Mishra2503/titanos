"""Account-safety guardrails. These run BEFORE Meta's own rate limits as a defense-
in-depth layer to keep accounts from being flagged for bot-like behavior.

What we protect against:
- Posting bursts on the same account (caps + min gap).
- All accounts firing at the exact same second (jitter at publish).
- Posting beyond a sane creator cadence (daily/hourly caps well below Meta's 100/24h).
- Stale-cached publishing during account warming / token issues (status guards).

What this CANNOT do: stop Meta from flagging an account for content reasons. We do
not moderate content here — that's the user's responsibility.
"""
from __future__ import annotations

import random
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import conflict
from app.models.enums import ScheduledPostStatus
from app.models.scheduling import ScheduledPost

HealthLevel = Literal["GREEN", "YELLOW", "RED"]


def _as_utc(dt: datetime) -> datetime:
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


@dataclass
class ProposedPost:
    ig_account_id: str
    scheduled_at: datetime


async def _recent_posts_for_account(
    db: AsyncSession, ig_account_id: str, *, since: datetime
) -> list[ScheduledPost]:
    return list(
        await db.scalars(
            select(ScheduledPost).where(
                ScheduledPost.ig_account_id == ig_account_id,
                ScheduledPost.status.in_(
                    [
                        ScheduledPostStatus.SCHEDULED,
                        ScheduledPostStatus.PROCESSING,
                        ScheduledPostStatus.PUBLISHED,
                    ]
                ),
                ScheduledPost.scheduled_at >= since,
            )
        )
    )


async def validate_proposed_schedule(
    db: AsyncSession, proposed: list[ProposedPost]
) -> None:
    """Raise AppError if accepting these posts would breach safety caps. No-op when
    safety is disabled (e.g. for tests that need to schedule many posts at once)."""
    if not settings.safety_enabled or not proposed:
        return

    # Group proposed posts per account.
    by_account: dict[str, list[datetime]] = defaultdict(list)
    for p in proposed:
        by_account[p.ig_account_id].append(_as_utc(p.scheduled_at))

    for account_id, times in by_account.items():
        times.sort()

        # 1) Min-gap: within the proposed batch itself.
        for i in range(1, len(times)):
            gap = times[i] - times[i - 1]
            if gap < timedelta(minutes=settings.safety_min_gap_minutes):
                raise conflict(
                    "safety_min_gap",
                    f"Two posts on the same account are scheduled "
                    f"{int(gap.total_seconds() / 60)} min apart. "
                    f"Minimum safe gap is {settings.safety_min_gap_minutes} min.",
                )

        # Pull existing posts in widest relevant window (24h before earliest proposed).
        window_start = times[0] - timedelta(hours=24)
        existing = await _recent_posts_for_account(db, account_id, since=window_start)
        existing_times = sorted(_as_utc(p.scheduled_at) for p in existing)

        # 2) Min-gap: each proposed vs nearest existing.
        for t in times:
            for et in existing_times:
                gap = abs((t - et).total_seconds()) / 60
                if gap < settings.safety_min_gap_minutes:
                    raise conflict(
                        "safety_min_gap",
                        f"Scheduled post is {int(gap)} min from another post on the "
                        f"same account. Minimum safe gap is "
                        f"{settings.safety_min_gap_minutes} min.",
                    )

        # 3) Hourly cap (rolling).
        for t in times:
            hour_start = t - timedelta(hours=1)
            in_hour = sum(1 for et in existing_times if hour_start <= et <= t) + sum(
                1 for ot in times if hour_start <= ot <= t and ot != t
            )
            if in_hour + 1 > settings.safety_hourly_cap:
                raise conflict(
                    "safety_hourly_cap",
                    f"Account would exceed the {settings.safety_hourly_cap} "
                    f"post-per-hour safety cap around {t.isoformat()}.",
                )

        # 4) Daily cap (rolling 24h).
        for t in times:
            day_start = t - timedelta(hours=24)
            in_day = sum(1 for et in existing_times if day_start <= et <= t) + sum(
                1 for ot in times if day_start <= ot <= t and ot != t
            )
            if in_day + 1 > settings.safety_daily_cap:
                raise conflict(
                    "safety_daily_cap",
                    f"Account would exceed the {settings.safety_daily_cap} "
                    f"post-per-day safety cap around {t.isoformat()}.",
                )


def apply_publish_jitter(scheduled_at: datetime) -> datetime:
    """Add ±N seconds of randomization so the actual publish timestamp doesn't look
    machine-precise. Returns scheduled_at unchanged if jitter is disabled or 0."""
    if not settings.safety_enabled or settings.safety_jitter_seconds <= 0:
        return scheduled_at
    delta = random.randint(-settings.safety_jitter_seconds, settings.safety_jitter_seconds)
    return scheduled_at + timedelta(seconds=delta)


@dataclass
class AccountHealth:
    ig_account_id: str
    username: str
    level: HealthLevel
    posts_24h: int
    posts_7d: int
    last_published_at: datetime | None
    next_safe_post_at: datetime | None
    reasons: list[str]


async def compute_account_health(
    db: AsyncSession, ig_account_id: str, username: str
) -> AccountHealth:
    """Per-account safety state derived purely from scheduled_post history."""
    now = datetime.now(UTC)
    rows = await _recent_posts_for_account(db, ig_account_id, since=now - timedelta(days=7))
    posts_24h = sum(
        1 for p in rows
        if p.status == ScheduledPostStatus.PUBLISHED
        and _as_utc(p.scheduled_at) >= now - timedelta(hours=24)
    )
    posts_7d = sum(
        1 for p in rows if p.status == ScheduledPostStatus.PUBLISHED
    )
    published = [
        _as_utc(p.scheduled_at)
        for p in rows
        if p.status == ScheduledPostStatus.PUBLISHED
    ]
    last_published = max(published) if published else None

    reasons: list[str] = []
    level: HealthLevel = "GREEN"

    if posts_24h >= settings.safety_daily_cap:
        level = "RED"
        reasons.append(
            f"Hit the {settings.safety_daily_cap}/day safety cap. Pause until tomorrow."
        )
    elif posts_24h >= max(1, settings.safety_daily_cap - 1):
        level = "YELLOW"
        reasons.append(
            f"Close to the daily safety cap ({posts_24h}/{settings.safety_daily_cap})."
        )

    if last_published is not None:
        gap_min = (now - last_published).total_seconds() / 60
        if gap_min < settings.safety_min_gap_minutes:
            if level != "RED":
                level = "YELLOW"
            reasons.append(
                f"Last post was {int(gap_min)} min ago; safe gap is "
                f"{settings.safety_min_gap_minutes} min."
            )

    next_safe = None
    if last_published is not None and level != "RED":
        next_safe = last_published + timedelta(minutes=settings.safety_min_gap_minutes)
        if next_safe < now:
            next_safe = None

    if level == "GREEN" and not reasons:
        reasons.append("Healthy cadence. Safe to schedule the next post.")

    return AccountHealth(
        ig_account_id=ig_account_id,
        username=username,
        level=level,
        posts_24h=posts_24h,
        posts_7d=posts_7d,
        last_published_at=last_published,
        next_safe_post_at=next_safe,
        reasons=reasons,
    )
