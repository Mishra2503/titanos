from __future__ import annotations

from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import Role, UserStatus


class User(UUIDMixin, TimestampMixin, Base):
    """A workspace member. Email is unique per workspace (FR-AUTH-1..4)."""

    __tablename__ = "user"
    __table_args__ = (UniqueConstraint("workspace_id", "email", name="uq_user_workspace_email"),)

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    email: Mapped[str] = mapped_column(String(320), index=True, nullable=False)
    # Nullable until an invited user sets a password on accept (FR-AUTH-3).
    password_hash: Mapped[str | None] = mapped_column(nullable=True)
    role: Mapped[Role] = mapped_column(
        SAEnum(Role, native_enum=False, length=16), default=Role.EDITOR, nullable=False
    )
    status: Mapped[UserStatus] = mapped_column(
        SAEnum(UserStatus, native_enum=False, length=16),
        default=UserStatus.ACTIVE,
        nullable=False,
    )

    # Single-use invite token (hashed) + expiry for VA invites (FR-AUTH-3).
    invite_token_hash: Mapped[str | None] = mapped_column(nullable=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)
