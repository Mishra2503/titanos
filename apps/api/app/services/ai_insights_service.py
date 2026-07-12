from __future__ import annotations

import json
import logging
from typing import Any

from anthropic import Anthropic
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.competitor_reel import CompetitorReel

log = logging.getLogger("titan.ai_insights")


class AIInsightsService:
    def __init__(self, db: AsyncSession):
        self.db = db
        self.client = Anthropic(api_key=settings.anthropic_api_key)

    async def analyze_reel(self, reel_id: str) -> dict[str, Any]:
        reel = await self.db.get(CompetitorReel, reel_id)
        if not reel:
            return {"error": "Reel not found"}

        prompt = f"""
You are an expert Instagram growth analyst.

Analyze this Reel and explain why it performed well:

**Reel Data:**
- Views: {reel.views}
- Likes: {reel.likes}
- Comments: {reel.comments}
- Engagement Rate: {reel.engagement_rate}%
- Caption: {reel.caption}
- Hashtags: {reel.hashtags}
- Media Type: {reel.media_type}

Provide structured JSON with: hook, why_it_worked, content_format, cta_strength, improvement_suggestions, key_takeaway
"""

        try:
            response = self.client.messages.create(
                model=settings.anthropic_model,
                max_tokens=800,
                messages=[{"role": "user", "content": prompt}]
            )
            # Parse and save insights
            return {"analysis": response.content[0].text}
        except Exception as e:
            return {"error": str(e)}
