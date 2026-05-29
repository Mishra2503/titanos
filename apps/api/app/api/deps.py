from __future__ import annotations

from typing import Annotated

import jwt
from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import forbidden, unauthorized
from app.core.security import decode_token
from app.db.session import get_db
from app.models.enums import Role, UserStatus
from app.models.user import User

_bearer = HTTPBearer(auto_error=False)

DbSession = Annotated[AsyncSession, Depends(get_db)]


async def get_current_user(
    db: DbSession,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
) -> User:
    """Resolve the authenticated user from a Bearer access token.

    Enforces token validity, type=access, active status, and that the token's
    workspace claim matches the user's workspace (Rail #4: server-side checks).
    """
    if credentials is None:
        raise unauthorized()

    try:
        payload = decode_token(credentials.credentials)
    except jwt.PyJWTError as exc:
        raise unauthorized("Invalid or expired token") from exc

    if payload.get("type") != "access":
        raise unauthorized("Wrong token type")

    user_id = payload.get("sub")
    if not user_id:
        raise unauthorized("Malformed token")

    user = await db.scalar(select(User).where(User.id == user_id))
    if user is None or user.status != UserStatus.ACTIVE:
        raise unauthorized("User not found or inactive")

    # Defense in depth: the token's workspace claim must match the user record.
    if payload.get("ws") != user.workspace_id:
        raise unauthorized("Workspace mismatch")

    return user


CurrentUser = Annotated[User, Depends(get_current_user)]


def require_role(*allowed: Role):
    """Dependency factory enforcing role on the SERVER for every guarded route (Rail #4)."""

    async def _guard(user: CurrentUser) -> User:
        if user.role not in allowed:
            raise forbidden(f"Requires one of: {', '.join(r.value for r in allowed)}")
        return user

    return _guard
