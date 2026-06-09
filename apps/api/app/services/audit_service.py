from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.audit import AuditLog


async def record(
    db: AsyncSession,
    *,
    workspace_id: str,
    user_id: str | None,
    action: str,
    entity: str | None = None,
    meta: dict[str, Any] | None = None,
) -> None:
    """Append an audit entry for a sensitive action (PRD §12)."""
    db.add(
        AuditLog(
            workspace_id=workspace_id,
            user_id=user_id,
            action=action,
            entity=entity,
            meta_json=meta or {},
        )
    )
