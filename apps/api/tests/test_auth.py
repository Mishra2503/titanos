from __future__ import annotations

import pytest

from tests.conftest import _login

pytestmark = pytest.mark.asyncio


async def test_health(client):
    resp = await client.get("/healthz")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


async def test_login_success_and_me(client, owner):
    token = await _login(client, "owner@test.com", "ownerpass123")
    resp = await client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["email"] == "owner@test.com"
    assert body["role"] == "OWNER"


async def test_login_wrong_password(client, owner):
    resp = await client.post(
        "/api/auth/login", json={"email": "owner@test.com", "password": "nope"}
    )
    assert resp.status_code == 401
    assert resp.json()["error"]["code"] == "unauthorized"


async def test_me_requires_auth(client):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_refresh_rotates_tokens(client, owner):
    login = await client.post(
        "/api/auth/login", json={"email": "owner@test.com", "password": "ownerpass123"}
    )
    refresh_token = login.json()["refresh_token"]
    resp = await client.post("/api/auth/refresh", json={"refresh_token": refresh_token})
    assert resp.status_code == 200
    assert "access_token" in resp.json()


async def test_access_token_rejected_as_refresh(client, owner):
    token = await _login(client, "owner@test.com", "ownerpass123")
    resp = await client.post("/api/auth/refresh", json={"refresh_token": token})
    assert resp.status_code == 401


async def test_editor_cannot_invite(client, editor):
    token = await _login(client, "editor@test.com", "editorpass123")
    resp = await client.post(
        "/api/auth/invite",
        json={"email": "va@test.com", "role": "EDITOR"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403
    assert resp.json()["error"]["code"] == "forbidden"


async def test_owner_invite_accept_and_login(client, owner):
    token = await _login(client, "owner@test.com", "ownerpass123")
    inv = await client.post(
        "/api/auth/invite",
        json={"email": "va@test.com", "role": "EDITOR"},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert inv.status_code == 200
    invite_token = inv.json()["invite_token"]

    accept = await client.post(
        "/api/auth/accept-invite",
        json={"invite_token": invite_token, "password": "vapassword123"},
    )
    assert accept.status_code == 200

    login = await client.post(
        "/api/auth/login", json={"email": "va@test.com", "password": "vapassword123"}
    )
    assert login.status_code == 200


async def test_revoked_user_cannot_login(client, owner):
    token = await _login(client, "owner@test.com", "ownerpass123")
    inv = await client.post(
        "/api/auth/invite",
        json={"email": "va2@test.com", "role": "EDITOR"},
        headers={"Authorization": f"Bearer {token}"},
    )
    invite_token = inv.json()["invite_token"]
    await client.post(
        "/api/auth/accept-invite",
        json={"invite_token": invite_token, "password": "vapassword123"},
    )
    user_id = inv.json()["user"]["id"]

    revoke = await client.post(
        f"/api/auth/users/{user_id}/revoke",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert revoke.status_code == 200

    login = await client.post(
        "/api/auth/login", json={"email": "va2@test.com", "password": "vapassword123"}
    )
    assert login.status_code == 401
