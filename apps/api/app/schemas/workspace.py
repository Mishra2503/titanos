from __future__ import annotations

from pydantic import BaseModel, Field


class WorkspaceOut(BaseModel):
    id: str
    name: str
    plan: str
    member_count: int
    connection_count: int
    connection_limit: int

    model_config = {"from_attributes": True}


class WorkspaceUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
