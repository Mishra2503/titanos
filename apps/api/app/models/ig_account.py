from __future__ import annotations

from datetime import datetime

from sqlalchemy import Enum as SAEnum
from sqlalchemy import ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin
from app.models.enums import IgAccountStatus


class IgAccount(UUIDMixin, TimestampMixin, Base):
    """A connected Instagram Business/Creator account (PRD §9, FR-CONN-*).

    The long-lived access token is stored ENCRYPTED (Fernet) and never leaves the
    server (Rail #2). Same IG user can't be connected twice in one workspace.
    """

    __tablename__ = "ig_account"
    __table_args__ = (
        UniqueConstraint("workspace_id", "ig_user_id", name="uq_ig_account_workspace_iguser"),
    )

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    ig_user_id: Mapped[str] = mapped_column(nullable=False)
    username: Mapped[str] = mapped_column(nullable=False)
    account_type: Mapped[str | None] = mapped_column(nullable=True)
    fb_page_id: Mapped[str | None] = mapped_column(nullable=True)

    # Fernet-encrypted long-lived token. Never serialized to any API response.
    access_token_enc: Mapped[str] = mapped_column(nullable=False)
    token_expires_at: Mapped[datetime | None] = mapped_column(nullable=True)

    status: Mapped[IgAccountStatus] = mapped_column(
        SAEnum(IgAccountStatus, native_enum=False, length=16),
        default=IgAccountStatus.CONNECTED,
        nullable=False,
    )
    followers_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(nullable=True)
