from __future__ import annotations

import pytest

from app.services import connection_service, instagram_service
from tests.conftest import _login

pytestmark = pytest.mark.asyncio


def _fake_ig(monkeypatch, *, account_type="BUSINESS", username="brand", user_id="ig_1"):
    async def exchange_code_for_token(code):
        return {"access_token": "short", "user_id": user_id}

    async def exchange_for_long_lived(short):
        return {"access_token": "long-token", "expires_in": 5184000}

    async def fetch_profile(token):
        return {
            "user_id": user_id,
            "username": username,
            "account_type": account_type,
            "followers_count": 4200,
        }

    monkeypatch.setattr(instagram_service, "exchange_code_for_token", exchange_code_for_token)
    monkeypatch.setattr(instagram_service, "exchange_for_long_lived", exchange_for_long_lived)
    monkeypatch.setattr(instagram_service, "fetch_profile", fetch_profile)


async def test_complete_oauth_stores_encrypted_account(session_factory, workspace, monkeypatch):
    _fake_ig(monkeypatch)
    async with session_factory() as db:
        account = await connection_service.complete_oauth(
            db, workspace_id=workspace, code="abc"
        )
        await db.commit()
        assert account.username == "brand"
        assert account.followers_count == 4200
        # Token is stored ENCRYPTED, never as plaintext (Rail #2).
        assert account.access_token_enc != "long-token"
        assert "long-token" not in account.access_token_enc


async def test_personal_account_rejected(session_factory, workspace, monkeypatch):
    _fake_ig(monkeypatch, account_type="PERSONAL")
    async with session_factory() as db:
        with pytest.raises(Exception) as exc:
            await connection_service.complete_oauth(db, workspace_id=workspace, code="abc")
        assert "Business/Creator" in str(exc.value.detail)


async def test_connection_limit_enforced(session_factory, workspace, monkeypatch):
    async with session_factory() as db:
        for i in range(10):
            _fake_ig(monkeypatch, username=f"acct{i}", user_id=f"ig_{i}")
            await connection_service.complete_oauth(db, workspace_id=workspace, code="c")
        await db.commit()

        _fake_ig(monkeypatch, username="overflow", user_id="ig_999")
        with pytest.raises(Exception) as exc:
            await connection_service.complete_oauth(db, workspace_id=workspace, code="c")
        assert exc.value.code == "connection_limit"


async def test_editor_cannot_list_connections(client, editor):
    token = await _login(client, "editor@test.com", "editorpass123")
    resp = await client.get(
        "/api/connections", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 403


async def test_oauth_start_requires_config(client, owner):
    # Test env has no IG app credentials -> clear config error, not a broken redirect.
    token = await _login(client, "owner@test.com", "ownerpass123")
    resp = await client.get(
        "/api/connections/oauth/start", headers={"Authorization": f"Bearer {token}"}
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "not_configured"


async def test_list_includes_capacity(client, owner, session_factory, workspace, monkeypatch):
    _fake_ig(monkeypatch)
    async with session_factory() as db:
        await connection_service.complete_oauth(db, workspace_id=workspace, code="abc")
        await db.commit()

    async def fake_limit(ig_user_id, token):
        return {"data": [{"quota_usage": 3, "config": {"quota_total": 100}}]}

    monkeypatch.setattr(instagram_service, "fetch_publishing_limit", fake_limit)

    token = await _login(client, "owner@test.com", "ownerpass123")
    resp = await client.get("/api/connections", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["capacity"] == {"used": 3, "total": 100, "remaining": 97}
    # Ensure no token field leaks into the API response (Rail #2).
    assert "access_token" not in body[0]
    assert "access_token_enc" not in body[0]
