"""Server-side Claude calls for content board AI features.

Rail #2: the Anthropic key never leaves the server. Rail #1 alignment:
prompts only suggest organic captions/hashtags - never any duplicate-evasion
or scraping behavior.
"""
from __future__ import annotations

import os

from anthropic import AsyncAnthropic, AsyncAnthropicBedrock

from app.core.config import settings
from app.core.errors import bad_request
from app.models.board import BoardCard
from app.schemas.board import AiAction

_MAX_TOKENS = 1024

_SYSTEM = (
    "You are a senior short-form content strategist embedded inside Titan OS, "
    "helping Instagram Business/Creator accounts produce on-brand, high-performing "
    "Reels and posts. You write tight, punchy, conversational copy. You never use "
    "em dashes. You never fabricate metrics. Your suggestions must be ready to "
    "paste into Instagram without further editing."
)


def _client_and_model() -> tuple[AsyncAnthropic | AsyncAnthropicBedrock, str]:
    """Pick the configured Claude provider. Bedrock takes priority if set."""
    if settings.bedrock_api_key:
        # AsyncAnthropicBedrock uses boto3, which reads this env var as a bearer token.
        os.environ.setdefault("AWS_BEARER_TOKEN_BEDROCK", settings.bedrock_api_key)
        client = AsyncAnthropicBedrock(aws_region=settings.bedrock_aws_region)
        return client, settings.bedrock_model
    if settings.anthropic_api_key:
        return AsyncAnthropic(api_key=settings.anthropic_api_key), settings.anthropic_model
    raise bad_request(
        "ai_not_configured",
        "Add BEDROCK_API_KEY (or ANTHROPIC_API_KEY) to apps/api/.env to enable AI features.",
    )


def _card_context(card: BoardCard) -> str:
    parts: list[str] = [f"TITLE: {card.title}"]
    if card.status:
        parts.append(f"STATUS: {card.status}")
    if card.platforms:
        parts.append(f"PLATFORMS: {', '.join(card.platforms)}")
    if card.hook:
        parts.append(f"CURRENT HOOK: {card.hook}")
    if card.visual_hook:
        parts.append(f"VISUAL CONCEPT: {card.visual_hook}")
    if card.caption:
        parts.append(f"CURRENT CAPTION:\n{card.caption}")
    if card.hashtags:
        parts.append(f"CURRENT HASHTAGS: {' '.join(card.hashtags)}")
    if card.notes:
        parts.append(f"NOTES: {card.notes}")
    return "\n".join(parts)


def _prompt_for(action: AiAction, card: BoardCard, instruction: str | None) -> str:
    ctx = _card_context(card)
    extra = f"\nADDITIONAL INSTRUCTION: {instruction}" if instruction else ""
    if action == "hooks":
        return (
            f"{ctx}{extra}\n\n"
            "Write 5 alternative opening hooks (the first spoken line of the reel) for this idea.\n"
            "Each hook MUST: be under 12 words, create immediate curiosity, and be different "
            "in pattern from the others (question, contrarian claim, stat, story, callout). "
            "Output as a plain numbered list, one hook per line, no commentary."
        )
    if action == "caption":
        return (
            f"{ctx}{extra}\n\n"
            "Write the Instagram caption for this post. Structure: a strong first line that "
            "hooks (under 90 chars), 2-4 short body lines that deliver value, and a single "
            "comment-keyword CTA on the final line (e.g. 'Comment NOTEBOOK and I'll send it'). "
            "Total under 220 words. Output ONLY the caption text, no labels or quotes."
        )
    if action == "hashtags":
        return (
            f"{ctx}{extra}\n\n"
            "Suggest 12-15 Instagram hashtags for this post. Mix: 3 broad (high volume), "
            "6 niche (mid volume), 4 micro (low competition, specific to the topic). "
            "Output as a single line, space-separated, each starting with #. Lowercase only."
        )
    if action == "refine":
        target = card.caption or card.hook or card.notes or card.title
        return (
            f"{ctx}{extra}\n\n"
            f"Improve the following text. Keep the meaning. Make it tighter, punchier, "
            f"and more scroll-stopping. Output only the improved text, no commentary.\n\n"
            f"TEXT:\n{target}"
        )
    raise bad_request("unknown_action", f"Unknown AI action: {action}")


async def run_card_action(
    card: BoardCard, *, action: AiAction, instruction: str | None
) -> str:
    client, model = _client_and_model()
    msg = await client.messages.create(
        model=model,
        max_tokens=_MAX_TOKENS,
        system=_SYSTEM,
        messages=[{"role": "user", "content": _prompt_for(action, card, instruction)}],
    )
    # The SDK returns content as a list of typed blocks; we send only text in.
    return "".join(getattr(b, "text", "") for b in msg.content).strip()
