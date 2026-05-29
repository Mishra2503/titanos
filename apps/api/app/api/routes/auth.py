from __future__ import annotations

import jwt
from fastapi import APIRouter, Depends, status
from sqlalchemy import select

from app.api.deps import CurrentUser, DbSession, require_role
from app.core.errors import unauthorized
from app.core.security import create_token, decode_token
from app.models.enums import Role, UserStatus
from app.models.user import User
from app.schemas.auth import (
    AcceptInviteRequest,
    InviteOut,
    InviteRequest,
    LoginRequest,
    RefreshRequest,
    TokenPair,
    UserOut,
)
from app.services import audit_service, auth_service

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _issue_pair(user: User) -> TokenPair:
    return TokenPair(
        access_token=create_token(
            user.id, workspace_id=user.workspace_id, role=user.role.value, token_type="access"
        ),
        refresh_token=create_token(
            user.id, workspace_id=user.workspace_id, role=user.role.value, token_type="refresh"
        ),
    )


@router.post("/login", response_model=TokenPair)
async def login(payload: LoginRequest, db: DbSession) -> TokenPair:
    user = await auth_service.authenticate(db, payload.email, payload.password)
    await audit_service.record(
        db, workspace_id=user.workspace_id, user_id=user.id, action="auth.login"
    )
    await db.commit()
    return _issue_pair(user)


@router.post("/refresh", response_model=TokenPair)
async def refresh(payload: RefreshRequest, db: DbSession) -> TokenPair:
    try:
        claims = decode_token(payload.refresh_token)
    except jwt.PyJWTError as exc:
        raise unauthorized("Invalid or expired refresh token") from exc
    if claims.get("type") != "refresh":
        raise unauthorized("Wrong token type")

    user = await db.scalar(select(User).where(User.id == claims.get("sub")))
    if user is None or user.status != UserStatus.ACTIVE:
        raise unauthorized("User not found or inactive")
    return _issue_pair(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(user: CurrentUser, db: DbSession) -> None:
    # Stateless JWT: client discards tokens. We record the event for audit.
    await audit_service.record(
        db, workspace_id=user.workspace_id, user_id=user.id, action="auth.logout"
    )
    await db.commit()


@router.get("/me", response_model=UserOut)
async def me(user: CurrentUser) -> User:
    return user


@router.post("/invite", response_model=InviteOut)
async def invite(
    payload: InviteRequest,
    db: DbSession,
    owner: User = Depends(require_role(Role.OWNER)),
) -> InviteOut:
    user, raw_token = await auth_service.create_invite(
        db, workspace_id=owner.workspace_id, email=payload.email, role=payload.role
    )
    await audit_service.record(
        db,
        workspace_id=owner.workspace_id,
        user_id=owner.id,
        action="user.invite",
        entity=user.id,
        meta={"email": user.email, "role": user.role.value},
    )
    await db.commit()
    return InviteOut(user=UserOut.model_validate(user), invite_token=raw_token)


@router.post("/accept-invite", response_model=TokenPair)
async def accept_invite(payload: AcceptInviteRequest, db: DbSession) -> TokenPair:
    user = await auth_service.accept_invite(
        db, invite_token=payload.invite_token, password=payload.password
    )
    await db.commit()
    return _issue_pair(user)


@router.post("/users/{user_id}/revoke", response_model=UserOut)
async def revoke(
    user_id: str,
    db: DbSession,
    owner: User = Depends(require_role(Role.OWNER)),
) -> User:
    user = await auth_service.revoke_user(db, workspace_id=owner.workspace_id, user_id=user_id)
    await audit_service.record(
        db,
        workspace_id=owner.workspace_id,
        user_id=owner.id,
        action="user.revoke",
        entity=user.id,
    )
    await db.commit()
    return user
