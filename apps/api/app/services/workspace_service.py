from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import not_found
from app.models.enums import UserStatus
from app.models.ig_account import IgAccount
from app.models.user import User
from app.models.workspace import Workspace


async def get_workspace(db: AsyncSession, *, workspace_id: str) -> Workspace:
    ws = await db.scalar(select(Workspace).where(Workspace.id == workspace_id))
    if ws is None:
        raise not_found("Workspace not found")
    return ws


async def member_count(db: AsyncSession, *, workspace_id: str) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(User)
            .where(User.workspace_id == workspace_id, User.status != UserStatus.REVOKED)
        )
    ) or 0


async def connection_count(db: AsyncSession, *, workspace_id: str) -> int:
    return (
        await db.scalar(
            select(func.count())
            .select_from(IgAccount)
            .where(IgAccount.workspace_id == workspace_id)
        )
    ) or 0


async def rename_workspace(db: AsyncSession, *, workspace_id: str, name: str) -> Workspace:
    ws = await get_workspace(db, workspace_id=workspace_id)
    ws.name = name.strip()
    await db.flush()
    return ws
