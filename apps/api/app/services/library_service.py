"""Content Library: list master media assets with real usage stats (PRD §9 media_asset)."""
from __future__ import annotations

from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import conflict, not_found
from app.models.enums import ScheduledPostStatus
from app.models.scheduling import Campaign, MediaAsset, ScheduledPost
from app.models.user import User


async def list_assets(db: AsyncSession, workspace_id: str) -> list[dict[str, Any]]:
    """All master videos for a workspace, newest first, each annotated with how many
    campaigns / scheduled posts / published posts reference it. Counts are real — no
    fabricated numbers (Rail: honest analytics)."""
    assets = list(
        await db.scalars(
            select(MediaAsset)
            .where(MediaAsset.workspace_id == workspace_id)
            .order_by(MediaAsset.created_at.desc())
        )
    )
    if not assets:
        return []
    asset_ids = [a.id for a in assets]

    camp_rows = await db.execute(
        select(Campaign.media_asset_id, func.count(Campaign.id))
        .where(Campaign.media_asset_id.in_(asset_ids))
        .group_by(Campaign.media_asset_id)
    )
    campaigns = dict(camp_rows.all())

    sp_rows = await db.execute(
        select(Campaign.media_asset_id, func.count(ScheduledPost.id))
        .join(ScheduledPost, ScheduledPost.campaign_id == Campaign.id)
        .where(Campaign.media_asset_id.in_(asset_ids))
        .group_by(Campaign.media_asset_id)
    )
    scheduled = dict(sp_rows.all())

    pub_rows = await db.execute(
        select(Campaign.media_asset_id, func.count(ScheduledPost.id))
        .join(ScheduledPost, ScheduledPost.campaign_id == Campaign.id)
        .where(
            Campaign.media_asset_id.in_(asset_ids),
            ScheduledPost.status == ScheduledPostStatus.PUBLISHED,
        )
        .group_by(Campaign.media_asset_id)
    )
    published = dict(pub_rows.all())

    uploader_ids = [a.uploaded_by for a in assets if a.uploaded_by]
    emails: dict[str, str] = {}
    if uploader_ids:
        urows = await db.execute(select(User.id, User.email).where(User.id.in_(uploader_ids)))
        emails = dict(urows.all())

    return [
        {
            "asset": a,
            "campaigns": campaigns.get(a.id, 0),
            "scheduled_posts": scheduled.get(a.id, 0),
            "published_posts": published.get(a.id, 0),
            "uploaded_by_email": emails.get(a.uploaded_by) if a.uploaded_by else None,
        }
        for a in assets
    ]


async def delete_asset(db: AsyncSession, workspace_id: str, asset_id: str) -> str | None:
    """Delete an unused asset. Returns the Cloudinary public_id to clean up after commit.

    Blocked (409) when a campaign still references it — the DB FK is RESTRICT, and a
    silent failure would be worse than an explicit message."""
    asset = await db.scalar(
        select(MediaAsset).where(
            MediaAsset.id == asset_id, MediaAsset.workspace_id == workspace_id
        )
    )
    if asset is None:
        raise not_found("Asset not found")

    used = await db.scalar(
        select(func.count(Campaign.id)).where(Campaign.media_asset_id == asset_id)
    )
    if used:
        raise conflict(
            "asset_in_use",
            "This video is used by one or more campaigns and can't be deleted.",
        )

    public_id = asset.cloudinary_public_id
    await db.delete(asset)
    await db.flush()
    return public_id
