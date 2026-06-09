from __future__ import annotations

from typing import Any

from sqlalchemy import JSON, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, TimestampMixin, UUIDMixin


class AuditLog(UUIDMixin, TimestampMixin, Base):
    """Append-only audit trail for sensitive actions (PRD §12, §9)."""

    __tablename__ = "audit_log"

    workspace_id: Mapped[str] = mapped_column(
        ForeignKey("workspace.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[str | None] = mapped_column(
        ForeignKey("user.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(nullable=False)
    entity: Mapped[str | None] = mapped_column(nullable=True)
    meta_json: Mapped[dict[str, Any]] = mapped_column(JSON, default=dict, nullable=False)
