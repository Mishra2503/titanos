from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models.enums import IgAccountStatus


class CapacityOut(BaseModel):
    used: int | None = None
    total: int | None = None
    remaining: int | None = None


class ConnectionOut(BaseModel):
    """Sanitized connection view. The access token is NEVER included (Rail #2)."""

    id: str
    ig_user_id: str
    username: str
    account_type: str | None
    status: IgAccountStatus
    followers_count: int | None
    token_expires_at: datetime | None
    last_synced_at: datetime | None
    capacity: CapacityOut | None = None

    model_config = {"from_attributes": True}


class OAuthStartOut(BaseModel):
    authorize_url: str
