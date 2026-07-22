"""Cloudinary upload for master videos (PRD §5).

The Content Library accepts any video - vertical Reels, Shorts, horizontal/long-form,
large 4K masters. We deliberately do NOT gate uploads on duration / aspect ratio / size /
format here. Instagram's own Reel requirements are enforced at publish time (where Meta
returns the authoritative error), not at library upload time.
"""
from __future__ import annotations

import asyncio
import time
from typing import Any

import cloudinary
import cloudinary.uploader

from app.core.config import settings
from app.core.errors import bad_request


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


def _upload_sync(data: bytes, filename: str) -> dict[str, Any]:
    return cloudinary.uploader.upload(
        data,
        resource_type="video",
        folder="titan-os/masters",
        public_id=f"{int(time.time())}-{filename.rsplit('.', 1)[0]}",
        overwrite=False,
    )


async def upload_master(filename: str, data: bytes) -> dict[str, Any]:
    """Upload a master video to Cloudinary and return its metadata.

    No spec gate: any video is accepted. Cloudinary still enforces its own per-plan
    limits (file size / duration), and Meta enforces Reel requirements at publish time.
    """
    _ensure_configured()
    return await asyncio.to_thread(_upload_sync, data, filename)


async def destroy(cloudinary_public_id: str) -> None:
    if not _configured():
        return
    _ensure_configured()
    await asyncio.to_thread(
        cloudinary.uploader.destroy, cloudinary_public_id, resource_type="video"
    )
