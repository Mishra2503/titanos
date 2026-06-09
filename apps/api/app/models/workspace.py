from __future__ import annotations

from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin


class Workspace(UUIDMixin, TimestampMixin, Base):
    """Tenant boundary (FR-AUTH-4). One in MVP; many in Phase-2 SaaS."""

    __tablename__ = "workspace"

    name: Mapped[str] = mapped_column(nullable=False)
    plan: Mapped[str] = mapped_column(default="mvp", nullable=False)
