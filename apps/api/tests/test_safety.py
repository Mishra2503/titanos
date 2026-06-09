from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.config import settings
from app.core.security import encrypt_secret
from app.models.enums import IgAccountStatus, ScheduledPostStatus
from app.models.ig_account import IgAccount
from app.models.scheduling import Campaign, MediaAsset, ScheduledPost
from app.services import instagram_service, safety_service, scheduler_service
from app.services.safety_service import ProposedPost

pytestmark = pytest.mark.asyncio


@pytest.fixture(autouse=True)
def _enable_safety(monkeypatch):
    monkeypatch.setattr(settings, "safety_enabled", True)
    monkeypatch.setattr(settings, "safety_daily_cap", 3)
    monkeypatch.setattr(settings, "safety_hourly_cap", 1)
    monkeypatch.setattr(settings, "safety_min_gap_minutes", 90)
    monkeypatch.setattr(settings, "safety_jitter_seconds", 0)  # deterministic
    yield


async def _account(session_factory, workspace_id, uid="ig_safety"):
    async with session_factory() as db:
        a = IgAccount(
            workspace_id=workspace_id,
            ig_user_id=uid,
            username="safe",
            account_type="BUSINESS",
            access_token_enc=encrypt_secret("tok"),
            status=IgAccountStatus.CONNECTED,
        )
        db.add(a)
        await db.commit()
        return a.id


async def _media(session_factory, workspace_id):
    async with session_factory() as db:
        m = MediaAsset(
            workspace_id=workspace_id,
            filename="t.mp4",
            public_url="https://example.com/t.mp4",
            duration_s=30,
            width=1080,
            height=1920,
            format="mp4",
        )
        db.add(m)
        await db.commit()
        return m.id


async def test_min_gap_blocks_too_close(session_factory, workspace):
    acct = await _account(session_factory, workspace)
    base = datetime.now(UTC) + timedelta(hours=2)
    proposed = [
        ProposedPost(ig_account_id=acct, scheduled_at=base),
        # 30 minutes apart violates the 90-min default
        ProposedPost(ig_account_id=acct, scheduled_at=base + timedelta(minutes=30)),
    ]
    async with session_factory() as db:
        with pytest.raises(Exception) as exc:
            await safety_service.validate_proposed_schedule(db, proposed)
        assert exc.value.code == "safety_min_gap"


async def test_daily_cap_blocks_4th_post(session_factory, workspace):
    acct = await _account(session_factory, workspace)
    base = datetime.now(UTC) + timedelta(hours=2)
    # 4 posts spaced 100 min apart — within daily window, exceeds daily cap of 3.
    proposed = [
        ProposedPost(ig_account_id=acct, scheduled_at=base + timedelta(minutes=100 * i))
        for i in range(4)
    ]
    async with session_factory() as db:
        with pytest.raises(Exception) as exc:
            await safety_service.validate_proposed_schedule(db, proposed)
        assert exc.value.code in ("safety_daily_cap", "safety_hourly_cap", "safety_min_gap")


async def test_safe_schedule_passes(session_factory, workspace, monkeypatch):
    async def fake_limit(uid, tok):
        return {"data": [{"quota_usage": 0, "config": {"quota_total": 100}}]}

    monkeypatch.setattr(instagram_service, "fetch_publishing_limit", fake_limit)
    acct = await _account(session_factory, workspace)
    media = await _media(session_factory, workspace)
    base = datetime.now(UTC) + timedelta(hours=2)
    # 3 posts on the same account, spaced > 90 minutes — within all caps.
    posts = [
        {
            "ig_account_id": acct,
            "caption": f"safe {i}",
            "hashtags": [],
            "scheduled_at": base + timedelta(minutes=120 * i),
        }
        for i in range(3)
    ]
    async with session_factory() as db:
        c = await scheduler_service.create_campaign(
            db, workspace, media_asset_id=media, title=None, posts=posts, created_by=None
        )
        assert c.id


async def test_health_red_when_at_daily_cap(session_factory, workspace):
    acct = await _account(session_factory, workspace)
    now = datetime.now(UTC)
    # Insert 3 PUBLISHED rows in the last 24h (matches default safety_daily_cap=3).
    async with session_factory() as db:
        media = MediaAsset(
            workspace_id=workspace,
            filename="t.mp4",
            public_url="x",
        )
        db.add(media)
        await db.flush()
        camp = Campaign(workspace_id=workspace, media_asset_id=media.id)
        db.add(camp)
        await db.flush()
        for i in range(3):
            db.add(
                ScheduledPost(
                    workspace_id=workspace,
                    campaign_id=camp.id,
                    ig_account_id=acct,
                    caption=f"published {i}",
                    hashtags=[],
                    scheduled_at=now - timedelta(hours=i + 1),
                    status=ScheduledPostStatus.PUBLISHED,
                    idempotency_key=f"k{i}",
                )
            )
        await db.commit()

        health = await safety_service.compute_account_health(db, acct, "safe")
        assert health.level == "RED"
        assert health.posts_24h == 3
