"""SQLAlchemy models. Import all here so Alembic autogenerate sees every table."""

from app.models.audit import AuditLog
from app.models.board import BoardCard, BoardColumn
from app.models.competitor import (
    Competitor,
    CompetitorPost,
    CompetitorReport,
    CompetitorSnapshot,
)
from app.models.enums import (
    CampaignStatus,
    IgAccountStatus,
    Role,
    ScheduledPostStatus,
    UserStatus,
)
from app.models.ig_account import IgAccount
from app.models.scheduling import Campaign, MediaAsset, ScheduledPost
from app.models.user import User
from app.models.workspace import Workspace

__all__ = [
    "AuditLog",
    "BoardCard",
    "BoardColumn",
    "Campaign",
    "CampaignStatus",
    "Competitor",
    "CompetitorPost",
    "CompetitorReport",
    "CompetitorSnapshot",
    "IgAccount",
    "IgAccountStatus",
    "MediaAsset",
    "Role",
    "ScheduledPost",
    "ScheduledPostStatus",
    "User",
    "UserStatus",
    "Workspace",
]
