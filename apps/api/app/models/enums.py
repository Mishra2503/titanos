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
