from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import bad_request, conflict, not_found
from app.core.security import decrypt_secret
from app.models.enums import CampaignStatus, IgAccountStatus, ScheduledPostStatus
from app.models.ig_account import IgAccount
from app.models.scheduling import Campaign, MediaAsset, ScheduledPost
from app.services import instagram_service
from app.services.instagram_service import InstagramApiError


def _as_utc(dt: datetime) -> datetime:
    """SQLite drops tzinfo on round-trip; normalize so comparisons don't crash."""
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


async def _owned_media(db: AsyncSession, workspace_id: str, media_id: str) -> MediaAsset:
    media = await db.scalar(
        select(MediaAsset).where(
            MediaAsset.id == media_id, MediaAsset.workspace_id == workspace_id
        )
    )
    if media is None:
        raise not_found("Media asset not found")
    return media


async def _owned_post(db: AsyncSession, workspace_id: str, post_id: str) -> ScheduledPost:
    post = await db.scalar(
        select(ScheduledPost).where(
            ScheduledPost.id == post_id, ScheduledPost.workspace_id == workspace_id
        )
    )
    if post is None:
        raise not_found("Scheduled post not found")
    return post


async def _capacity_remaining(account: IgAccount) -> int | None:
    """Live remaining 24h publish capacity. None means unknown (treat as available)."""
    try:
        token = decrypt_secret(account.access_token_enc)
        data = await instagram_service.fetch_publishing_limit(account.ig_user_id, token)
    except (InstagramApiError, ValueError):
        return None
    rows = data.get("data") or []
    if not rows:
        return None
    row = rows[0]
    used = row.get("quota_usage")
    total = (row.get("config") or {}).get("quota_total")
    if isinstance(used, int) and isinstance(total, int):
        return max(0, total - used)
    return None


async def create_campaign(
    db: AsyncSession,
    workspace_id: str,
    *,
    media_asset_id: str,
    title: str | None,
    posts: list[dict[str, Any]],
    created_by: str | None,
) -> Campaign:
    media = await _owned_media(db, workspace_id, media_asset_id)

    # Validate accounts: owned by this workspace + connected (FR-CONN-5).
    account_ids = {p["ig_account_id"] for p in posts}
    accounts = list(
        await db.scalars(
            select(IgAccount).where(
                IgAccount.workspace_id == workspace_id,
                IgAccount.id.in_(account_ids),
            )
        )
    )
    if len(accounts) != len(account_ids):
        raise bad_request("invalid_account", "One or more selected accounts are not connected.")
    accounts_by_id = {a.id: a for a in accounts}
    if any(a.status != IgAccountStatus.CONNECTED for a in accounts):
        raise bad_request(
            "account_needs_reauth",
            "One or more selected accounts need re-auth before scheduling.",
        )

    # FR-SCHED-7: capacity guard. Reject the whole batch if any account would exceed cap.
    per_account_count: dict[str, int] = {}
    for p in posts:
        per_account_count[p["ig_account_id"]] = per_account_count.get(p["ig_account_id"], 0) + 1
    for acct_id, n in per_account_count.items():
        remaining = await _capacity_remaining(accounts_by_id[acct_id])
        if remaining is not None and n > remaining:
            raise conflict(
                "over_capacity",
                f"@{accounts_by_id[acct_id].username}: {n} scheduled exceeds remaining "
                f"24h capacity ({remaining}).",
            )

    now = datetime.now(UTC)
    for p in posts:
        if p["scheduled_at"] < now:
            raise bad_request(
                "scheduled_in_past",
                "Scheduled time must be in the future.",
            )

    campaign = Campaign(
        workspace_id=workspace_id,
        media_asset_id=media.id,
        title=title,
        status=CampaignStatus.APPROVED,
        created_by=created_by,
    )
    db.add(campaign)
    await db.flush()

    for p in posts:
        db.add(
            ScheduledPost(
                workspace_id=workspace_id,
                campaign_id=campaign.id,
                ig_account_id=p["ig_account_id"],
                caption=p["caption"],
                hashtags=p.get("hashtags") or [],
                scheduled_at=p["scheduled_at"],
                status=ScheduledPostStatus.SCHEDULED,
                idempotency_key=str(uuid.uuid4()),
            )
        )

    await db.commit()
    return campaign


async def list_schedule(db: AsyncSession, workspace_id: str) -> list[dict[str, Any]]:
    """All scheduled posts in this workspace, newest scheduled time first."""
    rows = list(
        await db.scalars(
            select(ScheduledPost)
            .where(ScheduledPost.workspace_id == workspace_id)
            .order_by(ScheduledPost.scheduled_at.desc())
        )
    )
    if not rows:
        return []
    account_ids = {r.ig_account_id for r in rows}
    accounts = list(
        await db.scalars(select(IgAccount).where(IgAccount.id.in_(account_ids)))
    )
    name_by_id = {a.id: a.username for a in accounts}
    campaign_ids = {r.campaign_id for r in rows}
    campaigns = list(
        await db.scalars(select(Campaign).where(Campaign.id.in_(campaign_ids)))
    )
    media_ids = {c.media_asset_id for c in campaigns}
    media_assets = list(
        await db.scalars(select(MediaAsset).where(MediaAsset.id.in_(media_ids)))
    )
    media_url_by_campaign = {
        c.id: next((m.public_url for m in media_assets if m.id == c.media_asset_id), None)
        for c in campaigns
    }
    return [
        {
            "id": r.id,
            "campaign_id": r.campaign_id,
            "ig_account_id": r.ig_account_id,
            "ig_username": name_by_id.get(r.ig_account_id, "?"),
            "caption": r.caption,
            "hashtags": r.hashtags,
            "scheduled_at": r.scheduled_at,
            "status": r.status,
            "permalink": r.permalink,
            "error": r.error,
            "attempts": r.attempts,
            "thumbnail_url": media_url_by_campaign.get(r.campaign_id),
        }
        for r in rows
    ]


async def update_scheduled_post(
    db: AsyncSession,
    workspace_id: str,
    post_id: str,
    *,
    caption: str | None,
    hashtags: list[str] | None,
    scheduled_at: datetime | None,
) -> ScheduledPost:
    post = await _owned_post(db, workspace_id, post_id)
    if post.status not in (ScheduledPostStatus.SCHEDULED, ScheduledPostStatus.FAILED):
        raise bad_request(
            "not_editable",
            f"Cannot edit a post that is {post.status.value}.",
        )
    if caption is not None:
        post.caption = caption
    if hashtags is not None:
        post.hashtags = hashtags
    if scheduled_at is not None:
        if scheduled_at < datetime.now(UTC):
            raise bad_request("scheduled_in_past", "Scheduled time must be in the future.")
        post.scheduled_at = scheduled_at
    await db.commit()
    return post


async def cancel_scheduled_post(
    db: AsyncSession, workspace_id: str, post_id: str
) -> ScheduledPost:
    post = await _owned_post(db, workspace_id, post_id)
    if post.status not in (ScheduledPostStatus.SCHEDULED, ScheduledPostStatus.FAILED):
        raise bad_request(
            "not_cancelable",
            f"Cannot cancel a post that is {post.status.value}.",
        )
    post.status = ScheduledPostStatus.CANCELED
    await db.commit()
    return post


async def retry_scheduled_post(
    db: AsyncSession, workspace_id: str, post_id: str
) -> ScheduledPost:
    post = await _owned_post(db, workspace_id, post_id)
    if post.status not in (ScheduledPostStatus.FAILED, ScheduledPostStatus.CANCELED):
        raise bad_request(
            "not_retryable",
            f"Only FAILED or CANCELED posts can be retried; this one is {post.status.value}.",
        )
    post.status = ScheduledPostStatus.SCHEDULED
    post.attempts = 0
    post.error = None
    post.container_id = None
    if _as_utc(post.scheduled_at) < datetime.now(UTC):
        post.scheduled_at = datetime.now(UTC)
    await db.commit()
    return post
