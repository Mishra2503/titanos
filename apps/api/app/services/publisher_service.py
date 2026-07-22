"""Instagram Reel publish pipeline (PRD §7.4 sub-flow C + Appendix A).

Worker-friendly: idempotent (Rail #5), retries with backoff, never double-publishes
on restart, never bypasses content_publishing_limit.
"""
from __future__ import annotations

import asyncio
import random
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import decrypt_secret
from app.db.session import SessionLocal
from app.models.enums import ScheduledPostStatus
from app.models.ig_account import IgAccount
from app.models.scheduling import Campaign, MediaAsset, ScheduledPost
from app.services import audit_service, instagram_service
from app.services.instagram_service import InstagramApiError

_POLL_INTERVAL = 5  # seconds between container status checks
_POLL_TIMEOUT = 300  # max 5 minutes waiting for container FINISHED (PRD Appendix A.4)
_CONTAINER_RETRY_LIMIT = 2  # PRD: max 2 container regenerations
# Stuck-PROCESSING recovery: if a row sat in PROCESSING longer than this, it's stale.
_STALE_PROCESSING = timedelta(minutes=15)


def _naive_utc(dt: datetime | None = None) -> datetime:
    """Return a tz-naive UTC datetime. asyncpg refuses to encode tz-aware values
    when our datetime columns happen to be TIMESTAMP WITHOUT TIME ZONE. Stripping
    tzinfo makes the same code work regardless of which column type the DB ended
    up with."""
    value = dt if dt is not None else datetime.now(UTC)
    return value.astimezone(UTC).replace(tzinfo=None) if value.tzinfo else value


def _compose_caption(post: ScheduledPost) -> str:
    """Caption + hashtags joined; matches what the Composer previewed."""
    tag_line = " ".join(post.hashtags) if post.hashtags else ""
    return f"{post.caption}\n\n{tag_line}".strip() if tag_line else post.caption


async def _check_capacity(account: IgAccount, token: str) -> tuple[int | None, int | None]:
    """Returns (remaining, total). Skips publishing if the account is at its 24h cap."""
    try:
        data = await instagram_service.fetch_publishing_limit(account.ig_user_id, token)
    except InstagramApiError:
        return None, None
    rows = data.get("data") or []
    if not rows:
        return None, None
    row = rows[0]
    used = row.get("quota_usage")
    total = (row.get("config") or {}).get("quota_total")
    if isinstance(used, int) and isinstance(total, int):
        return total - used, total
    return None, total


async def _await_container(container_id: str, token: str) -> str:
    """Poll until FINISHED, or raise InstagramApiError on ERROR/timeout."""
    deadline = asyncio.get_event_loop().time() + _POLL_TIMEOUT
    while True:
        status = await instagram_service.fetch_container_status(container_id, token)
        code = status.get("status_code") or status.get("status")
        if code == "FINISHED":
            return code
        if code == "ERROR" or code == "EXPIRED":
            raise InstagramApiError(f"Container {container_id} status={code}", payload=status)
        if asyncio.get_event_loop().time() > deadline:
            raise InstagramApiError(f"Container {container_id} still {code} after {_POLL_TIMEOUT}s")
        await asyncio.sleep(_POLL_INTERVAL)


async def _publish_single(db: AsyncSession, post: ScheduledPost) -> None:
    """Run the full publish flow for one post. Caller must already hold the PROCESSING lock."""
    account = await db.scalar(select(IgAccount).where(IgAccount.id == post.ig_account_id))
    campaign = await db.scalar(select(Campaign).where(Campaign.id == post.campaign_id))
    media = await db.scalar(select(MediaAsset).where(MediaAsset.id == campaign.media_asset_id))
    if not account or not media:
        raise RuntimeError("Account or media asset missing")

    token = decrypt_secret(account.access_token_enc)

    # Rail #5 - capacity guard. Don't even attempt if we're at cap.
    remaining, _ = await _check_capacity(account, token)
    if remaining is not None and remaining <= 0:
        raise InstagramApiError("Account at 24h publish capacity (0 remaining)")

    caption = _compose_caption(post)
    container_attempts = 0
    last_error: Exception | None = None

    # FR-SCHED-10: retry container creation up to _CONTAINER_RETRY_LIMIT times on processing error.
    while container_attempts <= _CONTAINER_RETRY_LIMIT:
        try:
            container_id = await instagram_service.create_reel_container(
                account.ig_user_id, token, video_url=media.public_url, caption=caption
            )
            post.container_id = container_id
            await db.commit()
            await _await_container(container_id, token)
            last_error = None
            break
        except InstagramApiError as exc:
            last_error = exc
            container_attempts += 1
            if container_attempts > _CONTAINER_RETRY_LIMIT:
                raise
            await asyncio.sleep(2 ** container_attempts)  # exponential backoff
    if last_error is not None:
        raise last_error

    # FR-SCHED-9: publish step.
    if settings.publish_mode == "dry_run":
        post.published_media_id = f"dryrun-{post.id}"
        post.permalink = None
    else:
        result = await instagram_service.publish_reel(
            account.ig_user_id, token, creation_id=post.container_id
        )
        media_id = str(result["id"])
        post.published_media_id = media_id
        post.permalink = await instagram_service.fetch_media_permalink(media_id, token)

    post.status = ScheduledPostStatus.PUBLISHED
    post.published_at = _naive_utc()
    post.error = None


async def _claim_due_post(db: AsyncSession, post_id: str) -> ScheduledPost | None:
    """Atomically transition SCHEDULED -> PROCESSING. Returns None if another worker won it."""
    now = _naive_utc()
    stmt = (
        update(ScheduledPost)
        .where(
            ScheduledPost.id == post_id,
            ScheduledPost.status == ScheduledPostStatus.SCHEDULED,
        )
        .values(
            status=ScheduledPostStatus.PROCESSING,
            processing_started_at=now,
            attempts=ScheduledPost.attempts + 1,
        )
    )
    result = await db.execute(stmt)
    await db.commit()
    if (result.rowcount or 0) == 0:
        return None
    return await db.scalar(select(ScheduledPost).where(ScheduledPost.id == post_id))


async def _reset_stale_processing(db: AsyncSession) -> None:
    """Recover posts stuck in PROCESSING from a crashed worker."""
    cutoff = _naive_utc() - _STALE_PROCESSING
    stmt = (
        update(ScheduledPost)
        .where(
            ScheduledPost.status == ScheduledPostStatus.PROCESSING,
            ScheduledPost.processing_started_at < cutoff,
        )
        .values(status=ScheduledPostStatus.SCHEDULED)
    )
    await db.execute(stmt)
    await db.commit()


async def tick() -> dict[str, int]:
    """One sweep of the publisher: recover stale, publish anything due. Idempotent."""
    published = failed = skipped = 0
    async with SessionLocal() as db:
        await _reset_stale_processing(db)
        due = list(
            await db.scalars(
                select(ScheduledPost).where(
                    ScheduledPost.status == ScheduledPostStatus.SCHEDULED,
                    ScheduledPost.scheduled_at <= datetime.now(UTC),
                    ScheduledPost.attempts < settings.publisher_max_attempts,
                )
            )
        )

    for due_post in due:
        async with SessionLocal() as db:
            post = await _claim_due_post(db, due_post.id)
            if post is None:
                skipped += 1
                continue
            # Anti-bot jitter: if multiple posts come up due in the same tick, spread
            # their actual API calls by 0..safety_jitter_seconds (random per post) so
            # nothing looks machine-precise to Meta's safety systems.
            if settings.safety_enabled and settings.safety_jitter_seconds > 0:
                await asyncio.sleep(random.uniform(0, settings.safety_jitter_seconds))
            try:
                await _publish_single(db, post)
                await audit_service.record(
                    db,
                    workspace_id=post.workspace_id,
                    user_id=None,
                    action="post.published",
                    entity=post.id,
                    meta={
                        "ig_account_id": post.ig_account_id,
                        "media_id": post.published_media_id,
                        "permalink": post.permalink,
                        "dry_run": settings.publish_mode == "dry_run",
                    },
                )
                published += 1
            except Exception as exc:  # noqa: BLE001 - store full message for the user
                post.status = (
                    ScheduledPostStatus.FAILED
                    if post.attempts >= settings.publisher_max_attempts
                    else ScheduledPostStatus.SCHEDULED  # let it retry on a later tick
                )
                post.error = str(exc)[:1900]
                await audit_service.record(
                    db,
                    workspace_id=post.workspace_id,
                    user_id=None,
                    action="post.failed",
                    entity=post.id,
                    meta={
                        "ig_account_id": post.ig_account_id,
                        "error": post.error[:300],
                        "attempts": post.attempts,
                    },
                )
                failed += 1
            await db.commit()

    return {"published": published, "failed": failed, "skipped": skipped, "due": len(due)}
