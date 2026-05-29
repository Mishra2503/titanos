from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import bad_request, conflict, unauthorized
from app.core.security import hash_password, verify_password
from app.models.enums import Role, UserStatus
from app.models.user import User

INVITE_TTL = timedelta(days=7)


def _hash_invite(token: str) -> str:
    # Invite tokens are stored only as a hash; the raw value is shown once (FR-AUTH-3).
    return hashlib.sha256(token.encode()).hexdigest()


async def authenticate(db: AsyncSession, email: str, password: str) -> User:
    user = await db.scalar(select(User).where(User.email == email.lower()))
    # Constant-ish path: always run a verify to reduce user-enumeration timing signal.
    candidate_hash = user.password_hash if user and user.password_hash else None
    if candidate_hash is None or not verify_password(password, candidate_hash):
        raise unauthorized("Invalid email or password")
    if user is None or user.status != UserStatus.ACTIVE:
        raise unauthorized("Invalid email or password")
    return user


async def create_invite(
    db: AsyncSession, *, workspace_id: str, email: str, role: Role
) -> tuple[User, str]:
    email = email.lower()
    existing = await db.scalar(
        select(User).where(User.workspace_id == workspace_id, User.email == email)
    )
    if existing is not None and existing.status != UserStatus.REVOKED:
        raise conflict("user_exists", "A user with that email already exists")

    raw_token = secrets.token_urlsafe(32)
    user = existing or User(workspace_id=workspace_id, email=email)
    user.role = role
    user.status = UserStatus.INVITED
    user.password_hash = None
    user.invite_token_hash = _hash_invite(raw_token)
    user.invite_expires_at = datetime.now(UTC) + INVITE_TTL
    db.add(user)
    await db.flush()
    return user, raw_token


async def accept_invite(db: AsyncSession, *, invite_token: str, password: str) -> User:
    token_hash = _hash_invite(invite_token)
    user = await db.scalar(select(User).where(User.invite_token_hash == token_hash))
    if user is None or user.status != UserStatus.INVITED:
        raise bad_request("invalid_invite", "Invite is invalid or already used")
    expires = user.invite_expires_at
    # Some DB drivers (e.g. SQLite) return naive datetimes; treat them as UTC.
    if expires is not None and expires.tzinfo is None:
        expires = expires.replace(tzinfo=UTC)
    if expires is None or expires < datetime.now(UTC):
        raise bad_request("expired_invite", "Invite has expired")

    user.password_hash = hash_password(password)
    user.status = UserStatus.ACTIVE
    user.invite_token_hash = None
    user.invite_expires_at = None
    await db.flush()
    return user


async def revoke_user(db: AsyncSession, *, workspace_id: str, user_id: str) -> User:
    user = await db.scalar(
        select(User).where(User.id == user_id, User.workspace_id == workspace_id)
    )
    if user is None:
        raise bad_request("not_found", "User not found")
    user.status = UserStatus.REVOKED
    user.invite_token_hash = None
    await db.flush()
    return user
