"""AI-generated competitor strategy reports (server-side Claude, Rail #2).

The model only ever sees data the user entered. The system prompt forbids inventing
metrics; where data is thin, the report says so and tells the user what to track next.
"""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.competitor import CompetitorReport
from app.services import competitor_service
from app.services.ai_service import _client_and_model

_MAX_TOKENS = 3000

_SYSTEM = (
    "You are a senior Instagram growth strategist embedded inside Titan OS. You analyze a "
    "competitor purely from the structured data provided (snapshots, saved posts, hashtags, "
    "notes). You NEVER invent or estimate metrics that are not present - if reach, saves or "
    "other figures are missing, say they are not available and note what to track instead. "
    "You never use em dashes. You write in clear markdown with short, scannable sections and "
    "concrete, do-this-next actions. Your goal: a plan for the user to outgrow this competitor."
)


def _fmt_competitor(detail: dict[str, Any]) -> str:
    a = detail["analytics"]
    lines: list[str] = [
        f"COMPETITOR: @{detail['username']}"
        + (f" ({detail['display_name']})" if detail.get("display_name") else ""),
    ]
    if detail.get("category"):
        lines.append(f"NICHE: {detail['category']}")
    if detail.get("notes"):
        lines.append(f"USER NOTES: {detail['notes']}")

    lines.append("\nTRACKED METRICS:")
    lines.append(f"- Latest followers: {a['latest_followers'] if a['latest_followers'] is not None else 'unknown'}")
    if a["follower_delta"] is not None:
        since = a["growth_since"]
        lines.append(
            f"- Follower growth: {a['follower_delta']:+d} "
            f"({a['follower_delta_pct']:+.1f}% since {since})"
        )
    if a["avg_engagement_rate"] is not None:
        lines.append(f"- Avg engagement rate: {a['avg_engagement_rate']}%")
    if a["posts_per_week"] is not None:
        lines.append(f"- Posting cadence: ~{a['posts_per_week']} posts/week")
    if a["content_mix"]:
        mix = ", ".join(f"{k}: {v}" for k, v in a["content_mix"].items())
        lines.append(f"- Content mix (saved posts): {mix}")
    if a["top_hashtags"]:
        tags = ", ".join(
            f"{h['tag']}(x{h['count']}"
            + (f", avg eng {h['avg_engagement']}" if h["avg_engagement"] is not None else "")
            + ")"
            for h in a["top_hashtags"][:12]
        )
        lines.append(f"- Most-used hashtags: {tags}")

    if detail["posts"]:
        lines.append("\nSAVED REFERENCE POSTS:")
        for p in detail["posts"][:12]:
            eng = p.get("engagement")
            bits = [f"[{p.get('post_type') or 'POST'}]"]
            if eng is not None:
                bits.append(f"{eng} interactions")
            if p.get("posted_on"):
                bits.append(str(p["posted_on"]))
            head = " ".join(bits)
            cap = (p.get("caption") or "").strip().replace("\n", " ")
            if len(cap) > 200:
                cap = cap[:200] + "…"
            line = f"- {head}: {cap}"
            if p.get("what_works"):
                line += f" | WHY IT WORKS: {p['what_works']}"
            lines.append(line)
    return "\n".join(lines)


async def _save(
    db: AsyncSession, *, workspace_id: str, competitor_id: str | None, title: str,
    content: str, model: str, created_by: str,
) -> CompetitorReport:
    report = CompetitorReport(
        workspace_id=workspace_id,
        competitor_id=competitor_id,
        title=title,
        content=content,
        model=model,
        generated_at=datetime.now(UTC),
        created_by=created_by,
    )
    db.add(report)
    await db.flush()
    return report


async def generate_competitor_report(
    db: AsyncSession, workspace_id: str, competitor_id: str, *, created_by: str
) -> CompetitorReport:
    detail = await competitor_service.get_detail(db, workspace_id, competitor_id)
    context = _fmt_competitor(detail)
    prompt = (
        f"{context}\n\n"
        "Write a detailed competitor analysis and a plan to outgrow them. Use these sections:\n"
        "1. Account snapshot (who they are, size, momentum)\n"
        "2. Content strategy and format mix\n"
        "3. Hashtag strategy (what they lean on, gaps)\n"
        "4. Posting cadence and consistency\n"
        "5. What is working (analyze the top saved posts)\n"
        "6. Gaps and opportunities I can exploit\n"
        "7. My 90-day plan to grow faster than them (concrete weekly actions)\n\n"
        "Base every claim only on the data above. Where data is missing, say so and tell me "
        "exactly what to start tracking."
    )
    client, model = _client_and_model()
    msg = await client.messages.create(
        model=model, max_tokens=_MAX_TOKENS, system=_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    content = "".join(getattr(b, "text", "") for b in msg.content).strip()
    title = f"Analysis: @{detail['username']} · {datetime.now(UTC):%b %d, %Y}"
    return await _save(
        db, workspace_id=workspace_id, competitor_id=competitor_id, title=title,
        content=content, model=model, created_by=created_by,
    )


async def generate_overview_report(
    db: AsyncSession, workspace_id: str, *, created_by: str
) -> CompetitorReport:
    items = await competitor_service.list_competitors(db, workspace_id)
    if not items:
        from app.core.errors import bad_request

        raise bad_request("no_competitors", "Add at least one competitor before generating a report.")

    lines = ["COMPETITIVE SET (tracked competitors):"]
    for it in items:
        parts = [f"@{it['username']}"]
        if it["latest_followers"] is not None:
            parts.append(f"{it['latest_followers']} followers")
        if it["avg_engagement_rate"] is not None:
            parts.append(f"{it['avg_engagement_rate']}% eng")
        if it["follower_delta"] is not None:
            parts.append(f"{it['follower_delta']:+d} recent")
        if it["category"]:
            parts.append(f"niche: {it['category']}")
        lines.append("- " + " · ".join(parts))
    context = "\n".join(lines)

    prompt = (
        f"{context}\n\n"
        "Write a competitive landscape report across all of these competitors. Sections:\n"
        "1. Where I stand vs the set (leaders, momentum, who to watch)\n"
        "2. Common patterns in what is working across them\n"
        "3. White space and gaps none of them own\n"
        "4. My positioning to win the niche\n"
        "5. A prioritized 90-day action plan to overtake the leaders\n\n"
        "Use only the data above. Where it is thin, say what to track next."
    )
    client, model = _client_and_model()
    msg = await client.messages.create(
        model=model, max_tokens=_MAX_TOKENS, system=_SYSTEM,
        messages=[{"role": "user", "content": prompt}],
    )
    content = "".join(getattr(b, "text", "") for b in msg.content).strip()
    title = f"Competitive landscape · {datetime.now(UTC):%b %d, %Y}"
    return await _save(
        db, workspace_id=workspace_id, competitor_id=None, title=title,
        content=content, model=model, created_by=created_by,
    )
