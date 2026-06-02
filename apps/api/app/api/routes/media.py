from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.deps import DbSession, require_role
from app.models.enums import Role
from app.models.user import User
from app.schemas.library import LibraryAssetOut, MediaUsage
from app.services import audit_service, library_service, media_service

router = APIRouter(prefix="/api/media", tags=["library"])

EditorOrOwner = Depends(require_role(Role.OWNER, Role.EDITOR))

_VIDEO_EXTS = (".mp4", ".mov", ".m4v")


def _thumbnail_url(public_url: str | None) -> str | None:
    """Cloudinary returns a poster frame when a video URL's extension is swapped to .jpg."""
    if not public_url:
        return None
    low = public_url.lower()
    for ext in _VIDEO_EXTS:
        if low.endswith(ext):
            return public_url[: -len(ext)] + ".jpg"
    return None


@router.get("", response_model=list[LibraryAssetOut])
async def list_media(db: DbSession, user: User = EditorOrOwner) -> list[LibraryAssetOut]:
    rows = await library_service.list_assets(db, user.workspace_id)
    return [
        LibraryAssetOut(
            id=r["asset"].id,
            filename=r["asset"].filename,
            public_url=r["asset"].public_url,
            thumbnail_url=_thumbnail_url(r["asset"].public_url),
            width=r["asset"].width,
            height=r["asset"].height,
            duration_s=r["asset"].duration_s,
            format=r["asset"].format,
            size_bytes=r["asset"].size_bytes,
            created_at=r["asset"].created_at,
            uploaded_by_email=r["uploaded_by_email"],
            in_use=r["campaigns"] > 0,
            usage=MediaUsage(
                campaigns=r["campaigns"],
                scheduled_posts=r["scheduled_posts"],
                published_posts=r["published_posts"],
            ),
        )
        for r in rows
    ]


@router.delete("/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_media(asset_id: str, db: DbSession, user: User = EditorOrOwner) -> None:
    public_id = await library_service.delete_asset(db, user.workspace_id, asset_id)
    await audit_service.record(
        db,
        workspace_id=user.workspace_id,
        user_id=user.id,
        action="media.delete",
        entity=asset_id,
    )
    await db.commit()
    # Best-effort Cloudinary cleanup; the DB row is already gone either way.
    if public_id:
        try:
            await media_service.destroy(public_id)
        except Exception:
            pass
