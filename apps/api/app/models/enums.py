from __future__ import annotations

from enum import StrEnum


class Role(StrEnum):
    """RBAC roles (PRD §3). OWNER = full admin; EDITOR = restricted (drafts only)."""

    OWNER = "OWNER"
    EDITOR = "EDITOR"


class UserStatus(StrEnum):
    ACTIVE = "ACTIVE"
    INVITED = "INVITED"
    REVOKED = "REVOKED"


class IgAccountStatus(StrEnum):
    """Connection health for a linked IG account (FR-CONN-5)."""

    CONNECTED = "CONNECTED"
    NEEDS_REAUTH = "NEEDS_REAUTH"
    WARMING = "WARMING"


class CampaignStatus(StrEnum):
    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    PARTIALLY_PUBLISHED = "PARTIALLY_PUBLISHED"
    DONE = "DONE"


class ScheduledPostStatus(StrEnum):
    """Lifecycle of an individual scheduled post (FR-SCHED-9..12)."""

    SCHEDULED = "SCHEDULED"
    PROCESSING = "PROCESSING"
    PUBLISHED = "PUBLISHED"
    FAILED = "FAILED"
    CANCELED = "CANCELED"
