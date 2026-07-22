"""Shared Pydantic field types for schemas."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated, Any

from pydantic import BeforeValidator


def _ensure_utc(v: Any) -> Any:
    """Coerce naive datetimes to UTC.

    SQLite drops tzinfo on round-trip; without this, Pydantic emits an ISO string
    with no timezone marker and JavaScript interprets it as local time - making
    every datetime in the UI off by the user's UTC offset.
    """
    if isinstance(v, datetime) and v.tzinfo is None:
        return v.replace(tzinfo=UTC)
    return v


# Use this anywhere a schema field returns a datetime that came from the DB.
UtcDatetime = Annotated[datetime, BeforeValidator(_ensure_utc)]
