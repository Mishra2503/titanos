from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import settings

# Short-lived signed state for the OAuth handshake. Carries the workspace it was
# initiated for so the callback can't be replayed against another workspace (CSRF).
_STATE_TTL = timedelta(minutes=15)
_PURPOSE = "ig_oauth_state"


def create_state(*, workspace_id: str, user_id: str) -> str:
    now = datetime.now(UTC)
    payload = {
        "purpose": _PURPOSE,
        "ws": workspace_id,
        "uid": user_id,
        "nonce": str(uuid.uuid4()),
        "iat": int(now.timestamp()),
        "exp": int((now + _STATE_TTL).timestamp()),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def verify_state(state: str) -> dict[str, str]:
    """Returns the decoded claims or raises jwt.PyJWTError / ValueError."""
    claims = jwt.decode(state, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    if claims.get("purpose") != _PURPOSE:
        raise ValueError("Invalid state purpose")
    return claims
