from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.core.security import encrypt_secret
from app.models.enums import IgAccountStatus, ScheduledPostStatus
from app.models.ig_account import IgAccount
from app.models.scheduling import MediaAsset
from app.services import instagram_service, scheduler_service

pytestmark = pytest.mark.asyncio


async def _make_account(session_factory, workspace_id, *, username="test", uid="ig_x"):
    async with session_factory() as db:
        a = IgAccount(
            workspace_id=workspace_id,
            ig_user_id=uid,
            username=username,
            account_type="BUSINESS",
            access_token_enc=encrypt_secret("tok"),
            status=IgAccountStatus.CONNECTED,
        )
        db.add(a)
        await db.commit()
        return a.id


async def _make_media(session_factory, workspace_id):
    async with session_factory() as db:
        m = MediaAsset(
            workspace_id=workspace_id,
            filename="test.mp4",
            public_url="https://example.com/test.mp4",
            duration_s=30.0,
            width=1080,
            height=1920,
            format="mp4",
        )
        db.add(m)
        await db.commit()
        return m.id


async def test_create_campaign_happy_path(session_factory, workspace, monkeypatch):
    async def fake_limit(uid, tok):
        return {"data": [{"quota_usage": 0, "config": {"quota_total": 100}}]}

    monkeypatch.setattr(instagram_service, "fetch_publishing_limit", fake_limit)
    acct_id = await _make_account(session_factory, workspace)
    media_id = await _make_media(session_factory, workspace)

    async with session_factory() as db:
        future = datetime.now(UTC) + timedelta(hours=1)
        campaign = await scheduler_service.create_campaign(
            db,
            workspace,
            media_asset_id=media_id,
            title="t",
            posts=[
                {
                    "ig_account_id": acct_id,
                    "caption": "Hello world",
                    "hashtags": ["#ai"],
                    "scheduled_at": future,
                }
            ],
            created_by=None,
        )
        rows = await scheduler_service.list_schedule(db, workspace)
        assert len(rows) == 1
        assert rows[0]["status"] == ScheduledPostStatus.SCHEDULED
        assert rows[0]["ig_username"] == "test"
        assert campaign.id


async def test_create_campaign_in_past_rejected(session_factory, workspace, monkeypatch):
    async def fake_limit(uid, tok):
        return {"data": [{"quota_usage": 0, "config": {"quota_total": 100}}]}

    monkeypatch.setattr(instagram_service, "fetch_publishing_limit", fake_limit)
    acct_id = await _make_account(session_factory, workspace)
    media_id = await _make_media(session_factory, workspace)
    async with session_factory() as db:
        past = datetime.now(UTC) - timedelta(minutes=5)
        with pytest.raises(Exception) as exc:
            await scheduler_service.create_campaign(
                db,
                workspace,
                media_asset_id=media_id,
                title=None,
                posts=[
                    {
                        "ig_account_id": acct_id,
                        "caption": "Late",
                        "hashtags": [],
                        "scheduled_at": past,
                    }
                ],
                created_by=None,
            )
        assert getattr(exc.value, "code", "") == "scheduled_in_past"


async def test_capacity_guard_blocks_over_cap(session_factory, workspace, monkeypatch):
    async def fake_limit_full(uid, tok):
        return {"data": [{"quota_usage": 99, "config": {"quota_total": 100}}]}

    monkeypatch.setattr(instagram_service, "fetch_publishing_limit", fake_limit_full)
    acct_id = await _make_account(session_factory, workspace)
    media_id = await _make_media(session_factory, workspace)
    async with session_factory() as db:
        future = datetime.now(UTC) + timedelta(hours=1)
        # 1 left in cap, scheduling 3 should be blocked
        with pytest.raises(Exception) as exc:
            await scheduler_service.create_campaign(
                db,
                workspace,
                media_asset_id=media_id,
                title=None,
                posts=[
                    {
                        "ig_account_id": acct_id,
                        "caption": f"p{i}",
                        "hashtags": [],
                        "scheduled_at": future + timedelta(minutes=i),
                    }
                    for i in range(3)
                ],
                created_by=None,
            )
        assert getattr(exc.value, "code", "") == "over_capacity"


async def test_cancel_then_retry_lifecycle(session_factory, workspace, monkeypatch):
    async def fake_limit(uid, tok):
        return {"data": [{"quota_usage": 0, "config": {"quota_total": 100}}]}

    monkeypatch.setattr(instagram_service, "fetch_publishing_limit", fake_limit)
    acct_id = await _make_account(session_factory, workspace)
    media_id = await _make_media(session_factory, workspace)

    async with session_factory() as db:
        future = datetime.now(UTC) + timedelta(hours=1)
        campaign = await scheduler_service.create_campaign(
            db,
            workspace,
            media_asset_id=media_id,
            title=None,
            posts=[
                {
                    "ig_account_id": acct_id,
                    "caption": "x",
                    "hashtags": [],
                    "scheduled_at": future,
                }
            ],
            created_by=None,
        )
        rows = await scheduler_service.list_schedule(db, workspace)
        post_id = rows[0]["id"]

        canceled = await scheduler_service.cancel_scheduled_post(db, workspace, post_id)
        assert canceled.status == ScheduledPostStatus.CANCELED

        retried = await scheduler_service.retry_scheduled_post(db, workspace, post_id)
        assert retried.status == ScheduledPostStatus.SCHEDULED
        assert retried.attempts == 0
        assert campaign.id
