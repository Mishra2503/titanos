from __future__ import annotations

import pytest

from tests.conftest import _login

pytestmark = pytest.mark.asyncio


async def _auth(client, owner):
    token = await _login(client, "owner@test.com", "ownerpass123")
    return {"Authorization": f"Bearer {token}"}


async def test_board_seeds_default_columns(client, owner):
    h = await _auth(client, owner)
    resp = await client.get("/api/board", headers=h)
    assert resp.status_code == 200
    cols = resp.json()["columns"]
    assert [c["name"] for c in cols] == [
        "Ideas",
        "In progress",
        "Editing",
        "Ready to post",
        "Scheduled",
    ]
    assert all(c["cards"] == [] for c in cols)


async def test_card_crud_and_move(client, owner):
    h = await _auth(client, owner)
    cols = (await client.get("/api/board", headers=h)).json()["columns"]
    ideas, editing = cols[0]["id"], cols[2]["id"]

    created = await client.post(
        "/api/board/cards",
        json={"column_id": ideas, "title": "Hook test reel", "notes": "AMIT x SKEPTIC"},
        headers=h,
    )
    assert created.status_code == 201
    card_id = created.json()["id"]

    # Move the card into the Editing column via reorder.
    moved = await client.post(
        f"/api/board/columns/{editing}/reorder",
        json={"card_ids": [card_id]},
        headers=h,
    )
    assert moved.status_code == 204

    board = (await client.get("/api/board", headers=h)).json()["columns"]
    editing_col = next(c for c in board if c["id"] == editing)
    assert [c["id"] for c in editing_col["cards"]] == [card_id]

    # Edit + delete.
    upd = await client.patch(
        f"/api/board/cards/{card_id}", json={"title": "Updated title"}, headers=h
    )
    assert upd.status_code == 200 and upd.json()["title"] == "Updated title"

    deleted = await client.delete(f"/api/board/cards/{card_id}", headers=h)
    assert deleted.status_code == 204


async def test_add_and_delete_column(client, owner):
    h = await _auth(client, owner)
    created = await client.post("/api/board/columns", json={"name": "Backlog"}, headers=h)
    assert created.status_code == 201
    col_id = created.json()["id"]
    assert created.json()["name"] == "Backlog"

    deleted = await client.delete(f"/api/board/columns/{col_id}", headers=h)
    assert deleted.status_code == 204
