from __future__ import annotations

from pydantic import BaseModel, EmailStr, Field

from app.models.enums import Role, UserStatus


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1)


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserOut(BaseModel):
    id: str
    email: EmailStr
    role: Role
    status: UserStatus
    workspace_id: str

    model_config = {"from_attributes": True}


class InviteRequest(BaseModel):
    email: EmailStr
    role: Role = Role.EDITOR


class InviteOut(BaseModel):
    user: UserOut
    # Raw single-use token returned ONCE to the owner to share with the invitee.
    invite_token: str


class AcceptInviteRequest(BaseModel):
    invite_token: str
    password: str = Field(min_length=8)
