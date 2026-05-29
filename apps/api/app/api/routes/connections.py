from __future__ import annotations

import asyncio
from urllib.parse import urlencode

import jwt
from fastapi import APIRouter, Depends, Query
from fastapi.responses import RedirectResponse

from app.api.deps import DbSession, require_role
from app.core.config import settings
from app.core.oauth_state import create_state, verify_state
from app.models.enums import Role
from app.models.user import User
from app.schemas.connections import CapacityOut, ConnectionOut, OAuthStartOut
from app.services import audit_service, connection_service, instagram_service
from app.services.instagram_service import InstagramApiError

router = APIRouter(prefix="/api/connections", tags=["connections"])

OwnerDep = Depends(require_role(Role.OWNER))


@router.get("", response_model=list[ConnectionOut])
async def list_connections(db: DbSession, owner: User = OwnerDep) -> list[ConnectionOut]:
    accounts = await connection_service.list_accounts(db, owner.workspace_id)
    # Capacity is a live Graph API call per account — fetch concurrently (FR-CONN-5).
    capacities = await asyncio.gather(
        *(connection_service.get_capacity(a) for a in accounts), return_exceptions=True
    )
    out: list[ConnectionOut] = []
    for account, cap in zip(accounts, capacities, strict=True):
        model = ConnectionOut.model_validate(account)
        if isinstance(cap, dict):
            model.capacity = CapacityOut(**cap)
        out.append(model)
    return out


@router.get("/oauth/start", response_model=OAuthStartOut)
async def oauth_start(owner: User = OwnerDep) -> OAuthStartOut:
    if not settings.instagram_app_id or not settings.instagram_app_secret:
        # Surface a clear config error rather than bouncing the user to a broken IG page.
        from app.core.errors import bad_request

        raise bad_request("not_configured", "Instagram app credentials are not configured.")
    state = create_state(workspace_id=owner.workspace_id, user_id=owner.id)
    return OAuthStartOut(authorize_url=instagram_service.build_authorize_url(state))


@router.get("/oauth/callback")
async def oauth_callback(
    db: DbSession,
    code: str | None = Query(default=None),
    state: str | None = Query(default=None),
    error: str | None = Query(default=None),
    error_description: str | None = Query(default=None),
) -> RedirectResponse:
    """Instagram redirects the browser here (no bearer); trust is established via signed state."""
    redirect_base = f"{settings.web_base_url}/connections"

    def _redirect(params: dict[str, str]) -> RedirectResponse:
        return RedirectResponse(url=f"{redirect_base}?{urlencode(params)}", status_code=303)

    if error:
        return _redirect({"error": error_description or error})
    if not code or not state:
        return _redirect({"error": "Missing code or state"})

    try:
        claims = verify_state(state)
    except (jwt.PyJWTError, ValueError):
        return _redirect({"error": "Invalid or expired state"})

    workspace_id = claims["ws"]
    try:
        account = await connection_service.complete_oauth(
            db, workspace_id=workspace_id, code=code
        )
    except InstagramApiError as exc:
        await db.rollback()
        return _redirect({"error": f"Instagram error: {exc}"})
    except Exception as exc:  # noqa: BLE001 — surface a clean message, log server-side
        await db.rollback()
        detail = getattr(exc, "detail", None) or "Connection failed"
        return _redirect({"error": str(detail)})

    await audit_service.record(
        db,
        workspace_id=workspace_id,
        user_id=claims.get("uid"),
        action="connection.connect",
        entity=account.id,
        meta={"username": account.username},
    )
    await db.commit()
    return _redirect({"connected": account.username})


@router.post("/{account_id}/refresh", response_model=ConnectionOut)
async def refresh_connection(
    account_id: str, db: DbSession, owner: User = OwnerDep
) -> ConnectionOut:
    account = await connection_service.refresh_account(
        db, workspace_id=owner.workspace_id, account_id=account_id
    )
    await audit_service.record(
        db,
        workspace_id=owner.workspace_id,
        user_id=owner.id,
        action="connection.refresh",
        entity=account.id,
    )
    await db.commit()
    return ConnectionOut.model_validate(account)


@router.post("/{account_id}/disconnect", status_code=204)
async def disconnect_connection(
    account_id: str, db: DbSession, owner: User = OwnerDep
) -> None:
    await connection_service.disconnect(
        db, workspace_id=owner.workspace_id, account_id=account_id
    )
    await audit_service.record(
        db,
        workspace_id=owner.workspace_id,
        user_id=owner.id,
        action="connection.disconnect",
        entity=account_id,
    )
    await db.commit()
