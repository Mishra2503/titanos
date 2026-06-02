from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import CurrentUser, DbSession, require_role
from app.core.config import settings
from app.models.enums import Role
from app.models.user import User
from app.schemas.workspace import WorkspaceOut, WorkspaceUpdate
from app.services import audit_service, workspace_service

router = APIRouter(prefix="/api/workspace", tags=["workspace"])


async def _to_out(db: DbSession, ws) -> WorkspaceOut:
    return WorkspaceOut(
        id=ws.id,
        name=ws.name,
        plan=ws.plan,
        member_count=await workspace_service.member_count(db, workspace_id=ws.id),
        connection_count=await workspace_service.connection_count(db, workspace_id=ws.id),
        connection_limit=settings.max_connections_per_workspace,
    )


@router.get("", response_model=WorkspaceOut)
async def get_workspace(user: CurrentUser, db: DbSession) -> WorkspaceOut:
    ws = await workspace_service.get_workspace(db, workspace_id=user.workspace_id)
    return await _to_out(db, ws)


@router.patch("", response_model=WorkspaceOut)
async def update_workspace(
    payload: WorkspaceUpdate,
    db: DbSession,
    owner: User = Depends(require_role(Role.OWNER)),
) -> WorkspaceOut:
    ws = await workspace_service.rename_workspace(
        db, workspace_id=owner.workspace_id, name=payload.name
    )
    await audit_service.record(
        db,
        workspace_id=owner.workspace_id,
        user_id=owner.id,
        action="workspace.rename",
        meta={"name": ws.name},
    )
    await db.commit()
    return await _to_out(db, ws)
