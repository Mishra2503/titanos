from __future__ import annotations

from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import settings

# Instagram API with Instagram Login (Business). Official endpoints only (Rail #1).
AUTHORIZE_URL = "https://www.instagram.com/oauth/authorize"
TOKEN_URL = "https://api.instagram.com/oauth/access_token"
GRAPH_BASE = "https://graph.instagram.com"

SCOPES = (
    "instagram_business_basic,"
    "instagram_business_manage_insights,"
    "instagram_business_content_publish"
)

# Account types eligible to connect (FR-CONN-7). Personal accounts are rejected.
ELIGIBLE_ACCOUNT_TYPES = {"BUSINESS", "MEDIA_CREATOR", "CREATOR"}

_TIMEOUT = httpx.Timeout(20.0)


class InstagramApiError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, payload: Any = None) -> None:
        super().__init__(message)
        self.status = status
        self.payload = payload


def build_authorize_url(state: str) -> str:
    params = {
        "client_id": settings.instagram_app_id,
        "redirect_uri": settings.instagram_redirect_uri,
        "response_type": "code",
        "scope": SCOPES,
        "state": state,
    }
    return f"{AUTHORIZE_URL}?{urlencode(params)}"


async def _get_json(client: httpx.AsyncClient, url: str, params: dict[str, Any]) -> dict[str, Any]:
    resp = await client.get(url, params=params)
    data = resp.json()
    if resp.status_code >= 400 or "error" in data or "error_message" in data:
        raise InstagramApiError(
            data.get("error_message") or str(data.get("error") or "Instagram API error"),
            status=resp.status_code,
            payload=data,
        )
    return data


async def exchange_code_for_token(code: str) -> dict[str, Any]:
    """Authorization code -> short-lived IG user token. Returns {access_token, user_id}."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            TOKEN_URL,
            data={
                "client_id": settings.instagram_app_id,
                "client_secret": settings.instagram_app_secret,
                "grant_type": "authorization_code",
                "redirect_uri": settings.instagram_redirect_uri,
                "code": code,
            },
        )
        data = resp.json()
        if resp.status_code >= 400 or "access_token" not in data:
            raise InstagramApiError(
                data.get("error_message", "Token exchange failed"),
                status=resp.status_code,
                payload=data,
            )
        return data


async def exchange_for_long_lived(short_token: str) -> dict[str, Any]:
    """Short-lived -> long-lived (~60 day) token. Returns {access_token, expires_in}."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        return await _get_json(
            client,
            f"{GRAPH_BASE}/access_token",
            {
                "grant_type": "ig_exchange_token",
                "client_secret": settings.instagram_app_secret,
                "access_token": short_token,
            },
        )


async def refresh_long_lived(long_token: str) -> dict[str, Any]:
    """Refresh a long-lived token before its 60-day expiry (FR-CONN-4)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        return await _get_json(
            client,
            f"{GRAPH_BASE}/refresh_access_token",
            {"grant_type": "ig_refresh_token", "access_token": long_token},
        )


async def fetch_profile(token: str) -> dict[str, Any]:
    """Account identity + follower count. Used to validate eligibility (FR-CONN-7)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        return await _get_json(
            client,
            f"{GRAPH_BASE}/{settings.instagram_graph_version}/me",
            {
                "fields": "user_id,username,account_type,followers_count",
                "access_token": token,
            },
        )


async def create_reel_container(
    ig_user_id: str, token: str, *, video_url: str, caption: str
) -> str:
    """Step 1 of the publish flow (PRD Appendix A). Returns the creation_id."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/{settings.instagram_graph_version}/{ig_user_id}/media",
            data={
                "media_type": "REELS",
                "video_url": video_url,
                "caption": caption,
                "access_token": token,
            },
        )
        data = resp.json()
        if resp.status_code >= 400 or "id" not in data:
            raise InstagramApiError(
                data.get("error_message")
                or (data.get("error") or {}).get("message", "Container creation failed"),
                status=resp.status_code,
                payload=data,
            )
        return str(data["id"])


async def fetch_container_status(container_id: str, token: str) -> dict[str, Any]:
    """Step 2: poll container processing status. Returns {status_code, ...}."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        return await _get_json(
            client,
            f"{GRAPH_BASE}/{settings.instagram_graph_version}/{container_id}",
            {"fields": "status_code,status", "access_token": token},
        )


async def publish_reel(ig_user_id: str, token: str, *, creation_id: str) -> dict[str, Any]:
    """Step 3: publish a FINISHED container. Returns {id: media_id}."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{GRAPH_BASE}/{settings.instagram_graph_version}/{ig_user_id}/media_publish",
            data={"creation_id": creation_id, "access_token": token},
        )
        data = resp.json()
        if resp.status_code >= 400 or "id" not in data:
            raise InstagramApiError(
                data.get("error_message")
                or (data.get("error") or {}).get("message", "Publish failed"),
                status=resp.status_code,
                payload=data,
            )
        return data


async def fetch_media_permalink(media_id: str, token: str) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            data = await _get_json(
                client,
                f"{GRAPH_BASE}/{settings.instagram_graph_version}/{media_id}",
                {"fields": "permalink", "access_token": token},
            )
            return data.get("permalink")
    except InstagramApiError:
        return None


async def fetch_publishing_limit(ig_user_id: str, token: str) -> dict[str, Any]:
    """Live 24h publish-capacity from content_publishing_limit (FR-CONN-5 / Rail #5)."""
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        return await _get_json(
            client,
            f"{GRAPH_BASE}/{settings.instagram_graph_version}/{ig_user_id}/content_publishing_limit",
            {"fields": "quota_usage,config", "access_token": token},
        )


def _insights_url(obj_id: str) -> str:
    return f"{GRAPH_BASE}/{settings.instagram_graph_version}/{obj_id}/insights"


async def fetch_account_insights(
    ig_user_id: str, token: str, metrics: list[str], *, period: str = "days_28"
) -> dict[str, int]:
    """Account-level insights as {metric: value}. Reads `total_value.value`.

    IG rejects the whole batch if ANY metric is invalid for the account, so on a
    batch error we retry metric-by-metric and keep whatever succeeds (FR-INS-6).
    """

    async def _call(client: httpx.AsyncClient, ms: list[str]) -> list[dict[str, Any]]:
        resp = await client.get(
            _insights_url(ig_user_id),
            params={
                "metric": ",".join(ms),
                "period": period,
                "metric_type": "total_value",
                "access_token": token,
            },
        )
        data = resp.json()
        if resp.status_code >= 400 or "error" in data:
            raise InstagramApiError("account insights error", status=resp.status_code, payload=data)
        return data.get("data", [])

    out: dict[str, int] = {}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            rows = await _call(client, metrics)
        except InstagramApiError:
            rows = []
            for m in metrics:
                try:
                    rows.extend(await _call(client, [m]))
                except InstagramApiError:
                    continue
    for row in rows:
        value = (row.get("total_value") or {}).get("value")
        if isinstance(value, int):
            out[row["name"]] = value
    return out


async def fetch_media_list(ig_user_id: str, token: str, *, limit: int = 25) -> list[dict[str, Any]]:
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        data = await _get_json(
            client,
            f"{GRAPH_BASE}/{settings.instagram_graph_version}/{ig_user_id}/media",
            {
                "fields": (
                    "id,media_type,media_product_type,caption,timestamp,"
                    "permalink,thumbnail_url,media_url"
                ),
                "limit": str(limit),
                "access_token": token,
            },
        )
    return data.get("data", [])


async def fetch_media_insights(
    media_id: str, token: str, metrics: list[str]
) -> dict[str, int]:
    """Per-post insights as {metric: value}. Reads `values[0].value`, with per-metric fallback."""

    async def _call(client: httpx.AsyncClient, ms: list[str]) -> list[dict[str, Any]]:
        resp = await client.get(
            _insights_url(media_id),
            params={"metric": ",".join(ms), "access_token": token},
        )
        data = resp.json()
        if resp.status_code >= 400 or "error" in data:
            raise InstagramApiError("media insights error", status=resp.status_code, payload=data)
        return data.get("data", [])

    out: dict[str, int] = {}
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        try:
            rows = await _call(client, metrics)
        except InstagramApiError:
            rows = []
            for m in metrics:
                try:
                    rows.extend(await _call(client, [m]))
                except InstagramApiError:
                    continue
    for row in rows:
        values = row.get("values") or []
        if values and isinstance(values[0].get("value"), int):
            out[row["name"]] = values[0]["value"]
    return out
