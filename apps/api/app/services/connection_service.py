from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import bad_request, conflict, not_found
from app.core.security import decrypt_secret, encrypt_secret
from app.models.enums import IgAccountStatus
from app.models.ig_account import IgAccount
from app.services import instagram_service
from app.services.instagram_service import ELIGIBLE_ACCOUNT_TYPES, InstagramApiError


async def list_accounts(db: AsyncSession, workspace_id: str) -> list[IgAccount]:
    result = await db.scalars(
        select(IgAccount)
        .where(IgAccount.workspace_id == workspace_id)
        .order_by(IgAccount.created_at)
    )
    return list(result)


async def _active_count(db: AsyncSession, workspace_id: str, *, exclude_ig_user_id: str) -> int:
    stmt = select(func.count()).select_from(IgAccount).where(
        IgAccount.workspace_id == workspace_id,
        IgAccount.ig_user_id != exclude_ig_user_id,
    )
    return (await db.scalar(stmt)) or 0


async def complete_oauth(db: AsyncSession, *, workspace_id: str, code: str) -> IgAccount:
    """Run the full connect flow: code -> long-lived token -> validate -> store encrypted."""
    short = await instagram_service.exchange_code_for_token(code)
    long_lived = await instagram_service.exchange_for_long_lived(short["access_token"])
    token = long_lived["access_token"]
    expires_at = datetime.now(UTC) + timedelta(seconds=int(long_lived.get("expires_in", 0)))

    profile = await instagram_service.fetch_profile(token)
    account_type = (profile.get("account_type") or "").upper()
    if account_type not in ELIGIBLE_ACCOUNT_TYPES:
        # FR-CONN-7: personal accounts get an actionable error.
        raise bad_request(
            "ineligible_account",
            "This is not a Business/Creator account. Convert it to a Business or Creator "
            "account linked to a Facebook Page, then reconnect.",
        )

    ig_user_id = str(profile.get("user_id") or short.get("user_id"))

    existing = await db.scalar(
        select(IgAccount).where(
            IgAccount.workspace_id == workspace_id, IgAccount.ig_user_id == ig_user_id
        )
    )

    if existing is None:
        # FR-CONN-3: cap connections per workspace.
        if await _active_count(db, workspace_id, exclude_ig_user_id=ig_user_id) >= (
            settings.max_connections_per_workspace
        ):
            raise conflict(
                "connection_limit",
                f"Connection limit reached ({settings.max_connections_per_workspace}).",
            )
        existing = IgAccount(workspace_id=workspace_id, ig_user_id=ig_user_id)

    existing.username = profile.get("username", existing.username or ig_user_id)
    existing.account_type = account_type
    existing.access_token_enc = encrypt_secret(token)
    existing.token_expires_at = expires_at
    existing.status = IgAccountStatus.CONNECTED
    existing.followers_count = profile.get("followers_count")
    existing.last_synced_at = datetime.now(UTC)
    db.add(existing)
    await db.flush()
    return existing


async def _get_owned(db: AsyncSession, workspace_id: str, account_id: str) -> IgAccount:
    account = await db.scalar(
        select(IgAccount).where(
            IgAccount.id == account_id, IgAccount.workspace_id == workspace_id
        )
    )
    if account is None:
        raise not_found("Connection not found")
    return account


async def refresh_account(db: AsyncSession, *, workspace_id: str, account_id: str) -> IgAccount:
    account = await _get_owned(db, workspace_id, account_id)
    try:
        token = decrypt_secret(account.access_token_enc)
        refreshed = await instagram_service.refresh_long_lived(token)
    except (InstagramApiError, ValueError):
        account.status = IgAccountStatus.NEEDS_REAUTH
        await db.flush()
        raise bad_request("refresh_failed", "Token refresh failed; account needs re-auth.")

    account.access_token_enc = encrypt_secret(refreshed["access_token"])
    account.token_expires_at = datetime.now(UTC) + timedelta(
        seconds=int(refreshed.get("expires_in", 0))
    )
    account.status = IgAccountStatus.CONNECTED
    await db.flush()
    return account


async def disconnect(db: AsyncSession, *, workspace_id: str, account_id: str) -> None:
    # FR-CONN-6: delete stored credential. Queued posts are cancelled here in later phases.
    account = await _get_owned(db, workspace_id, account_id)
    await db.delete(account)
    await db.flush()


async def get_capacity(account: IgAccount) -> dict[str, int | None]:
    """Live remaining 24h publish capacity (FR-CONN-5). Returns {used, total, remaining}."""
    try:
        token = decrypt_secret(account.access_token_enc)
        data = await instagram_service.fetch_publishing_limit(account.ig_user_id, token)
    except (InstagramApiError, ValueError):
        return {"used": None, "total": None, "remaining": None}

    rows = data.get("data") or []
    if not rows:
        return {"used": None, "total": None, "remaining": None}
    row = rows[0]
    used = row.get("quota_usage")
    total = (row.get("config") or {}).get("quota_total")
    remaining = total - used if isinstance(total, int) and isinstance(used, int) else None
    return {"used": used, "total": total, "remaining": remaining}
