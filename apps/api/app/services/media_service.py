"""Cloudinary upload + Reel spec validation (PRD §5, FR-SCHED-1/2)."""
from __future__ import annotations

import asyncio
import time
from typing import Any

import cloudinary
import cloudinary.uploader

from app.core.config import settings
from app.core.errors import bad_request

# Accepted container formats. Cloudinary normalizes most camera output to these on upload.
ALLOWED_FORMATS = {"mp4", "mov", "m4v"}
ASPECT_TOLERANCE = 0.05  # allow small rounding (9:16 ≈ 0.5625)


def _configured() -> bool:
    return bool(
        settings.cloudinary_cloud_name
        and settings.cloudinary_api_key
        and settings.cloudinary_api_secret
    )


def _ensure_configured() -> None:
    if not _configured():
        raise bad_request(
            "cloudinary_not_configured",
            "Cloudinary credentials are not set. Add CLOUDINARY_CLOUD_NAME / API_KEY / "
            "API_SECRET to apps/api/.env.",
        )
    cloudinary.config(
        cloud_name=settings.cloudinary_cloud_name,
        api_key=settings.cloudinary_api_key,
        api_secret=settings.cloudinary_api_secret,
        secure=True,
    )


def _validate_specs(meta: dict[str, Any]) -> None:
    """Reel spec gate (FR-SCHED-1). Raises a user-friendly error on any violation."""
    fmt = (meta.get("format") or "").lower()
    if fmt and fmt not in ALLOWED_FORMATS:
        raise bad_request(
            "reel_format_invalid",
            f"Video format must be MP4 or MOV. Got: {fmt}.",
        )
    duration = meta.get("duration")
    if duration is None:
        raise bad_request("reel_no_duration", "Could not read video duration.")
    if duration < settings.reel_min_duration_sec or duration > settings.reel_max_duration_sec:
        raise bad_request(
            "reel_duration_invalid",
            f"Reel duration must be {settings.reel_min_duration_sec}–{settings.reel_max_duration_sec}s. "
            f"Got: {duration:.1f}s.",
        )
    width, height = meta.get("width"), meta.get("height")
    if width and height:
        aspect = width / height
        if abs(aspect - settings.reel_aspect_ratio) > ASPECT_TOLERANCE:
            raise bad_request(
                "reel_aspect_invalid",
                f"Reel aspect ratio must be 9:16 (vertical). Got: {width}×{height}.",
            )


def _upload_sync(data: bytes, filename: str) -> dict[str, Any]:
    return cloudinary.uploader.upload(
        data,
        resource_type="video",
        folder="titan-os/masters",
        public_id=f"{int(time.time())}-{filename.rsplit('.', 1)[0]}",
        overwrite=False,
    )


async def upload_master(filename: str, data: bytes) -> dict[str, Any]:
    """Upload a master video to Cloudinary. Returns the asset metadata + validation result."""
    _ensure_configured()
    meta = await asyncio.to_thread(_upload_sync, data, filename)
    try:
        _validate_specs(meta)
    except Exception:
        # Don't leave invalid assets sitting in the account.
        public_id = meta.get("public_id")
        if public_id:
            try:
                await asyncio.to_thread(
                    cloudinary.uploader.destroy, public_id, resource_type="video"
                )
            except Exception:
                pass
        raise
    return meta


async def destroy(cloudinary_public_id: str) -> None:
    if not _configured():
        return
    _ensure_configured()
    await asyncio.to_thread(
        cloudinary.uploader.destroy, cloudinary_public_id, resource_type="video"
    )
