from __future__ import annotations

import logging
import re
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import bad_request, conflict, not_found
from app.models.competitor import Competitor
from app.models.competitor_reel import CompetitorReel
from app.models.enums import CompetitorStatus

log = logging.getLogger("titan.competitor")


def extract_hashtags(caption: str | None) -> list[str]:
    if not caption:
        return []
    return re.findall(r"#(\w+)", caption)


class CompetitorService:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def add_competitor(
        self,
        workspace_id: str,
        ig_username: str,
        access_token: str,
    ) -> Competitor:
        ig_username = ig_username.lstrip("@").lower()

        existing = await self.db.scalar(
            select(Competitor).where(
                Competitor.workspace_id == workspace_id,
                Competitor.ig_username == ig_username,
            )
        )
        if existing:
            raise conflict(f"Competitor @{ig_username} already exists in this workspace")

        profile_data = await self._fetch_instagram_profile(ig_username, access_token)
        if not profile_data:
            raise bad_request(f"Could not fetch Instagram profile for @{ig_username}")

        competitor = Competitor(
            workspace_id=workspace_id,
            ig_username=ig_username,
            ig_user_id=profile_data["id"],
            profile_picture_url=profile_data.get("profile_picture_url"),
            biography=profile_data.get("biography"),
            website=profile_data.get("website"),
            follower_count=profile_data.get("followers_count"),
            media_count=profile_data.get("media_count"),
            status=CompetitorStatus.ACTIVE,
            last_synced_at=datetime.now(UTC),
        )

        self.db.add(competitor)
        await self.db.flush()

        await self._fetch_and_store_reels(competitor, access_token)

        await self.db.commit()
        await self.db.refresh(competitor)
        return competitor

    async def _fetch_instagram_profile(self, ig_username: str, access_token: str):
        fields = "id,username,profile_picture_url,biography,website,followers_count,media_count"
        url = f"https://graph.facebook.com/{settings.instagram_graph_version}/{ig_username}?fields={fields}&access_token={access_token}"

        async with httpx.AsyncClient(timeout=30.0) as client:
            try:
                resp = await client.get(url)
                if resp.status_code == 200:
                    return resp.json()
                return None
            except Exception:
                return None

    async def _fetch_and_store_reels(self, competitor: Competitor, access_token: str, limit: int = 50):
        fields = "id,media_type,media_url,thumbnail_url,caption,timestamp,like_count,comments_count,insights.metric(plays)"
        url = f"https://graph.facebook.com/{settings.instagram_graph_version}/{competitor.ig_user_id}/media?fields={fields}&limit={limit}&access_token={access_token}"

        async with httpx.AsyncClient(timeout=60.0) as client:
            try:
                resp = await client.get(url)
                if resp.status_code != 200:
                    return
                data = resp.json()
                for item in data.get("data", []):
                    # ... (full implementation from previous)
                    pass
            except Exception as exc:
                log.exception("Error fetching reels")
