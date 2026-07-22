from __future__ import annotations

from fastapi import APIRouter, Depends, File, Form, UploadFile, status

from app.api.deps import CurrentUser, DbSession, require_role
from app.core.errors import bad_request
from app.models.enums import Role
from app.models.scheduling import MediaAsset
from app.models.user import User
from app.schemas.scheduling import (
    CampaignCreate,
    CampaignOut,
    MediaAssetOut,
    ScheduledPostUpdate,
    ScheduleListItem,
)
from app.services import media_service, scheduler_service

router = APIRouter(prefix="/api", tags=["scheduling"])


@router.post("/media/upload", response_model=MediaAssetOut)
async def upload_media(
    db: DbSession,
    user: User = Depends(require_role(Role.OWNER, Role.EDITOR)),
    file: UploadFile = File(...),
    filename: str | None = Form(default=None),
) -> MediaAssetOut:
    # No app-level size/duration/aspect cap - the Content Library accepts any video.
    # Cloudinary (per-plan) and Meta (at publish) enforce their own real limits.
    data = await file.read()
    if len(data) == 0:
        raise bad_request("empty_file", "Uploaded file is empty.")
    name = filename or file.filename or "master.mp4"
    meta = await media_service.upload_master(name, data)

    asset = MediaAsset(
        workspace_id=user.workspace_id,
        filename=name,
        cloudinary_public_id=meta.get("public_id"),
        public_url=meta["secure_url"],
        width=meta.get("width"),
        height=meta.get("height"),
        duration_s=meta.get("duration"),
        format=meta.get("format"),
        size_bytes=meta.get("bytes"),
        uploaded_by=user.id,
    )
    db.add(asset)
    await db.commit()
    return MediaAssetOut.model_validate(asset)


@router.post("/campaigns", response_model=CampaignOut, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    payload: CampaignCreate, user: CurrentUser, db: DbSession
) -> CampaignOut:
    campaign = await scheduler_service.create_campaign(
        db,
        user.workspace_id,
        media_asset_id=payload.media_asset_id,
        title=payload.title,
        posts=[p.model_dump() for p in payload.posts],
        created_by=user.id,
    )
    # Re-fetch with relations via list endpoint shape
    from sqlalchemy import select  # local import to keep route module lean

    from app.models.scheduling import MediaAsset, ScheduledPost

    media = await db.scalar(
        select(MediaAsset).where(MediaAsset.id == campaign.media_asset_id)
    )
    posts = list(
        await db.scalars(
            select(ScheduledPost).where(ScheduledPost.campaign_id == campaign.id)
        )
    )
    from app.schemas.scheduling import MediaAssetOut, ScheduledPostOut

    return CampaignOut(
        id=campaign.id,
        title=campaign.title,
        status=campaign.status,
        media=MediaAssetOut.model_validate(media),
        posts=[ScheduledPostOut.model_validate(p) for p in posts],
        created_at=campaign.created_at,
    )


@router.get("/schedule", response_model=list[ScheduleListItem])
async def list_schedule(user: CurrentUser, db: DbSession) -> list[ScheduleListItem]:
    rows = await scheduler_service.list_schedule(db, user.workspace_id)
    return [ScheduleListItem(**r) for r in rows]


@router.patch("/schedule/{post_id}")
async def update_schedule(
    post_id: str, payload: ScheduledPostUpdate, user: CurrentUser, db: DbSession
) -> dict[str, str]:
    await scheduler_service.update_scheduled_post(
        db,
        user.workspace_id,
        post_id,
        caption=payload.caption,
        hashtags=payload.hashtags,
        scheduled_at=payload.scheduled_at,
    )
    return {"status": "ok"}


@router.post("/schedule/{post_id}/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_schedule(post_id: str, user: CurrentUser, db: DbSession) -> None:
    await scheduler_service.cancel_scheduled_post(db, user.workspace_id, post_id)


@router.post("/schedule/{post_id}/retry", status_code=status.HTTP_204_NO_CONTENT)
async def retry_schedule(post_id: str, user: CurrentUser, db: DbSession) -> None:
    await scheduler_service.retry_scheduled_post(db, user.workspace_id, post_id)
