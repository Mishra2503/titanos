from __future__ import annotations

from fastapi import APIRouter, Depends, status

from app.api.deps import CurrentUser, DbSession, require_role
from app.models.enums import Role
from app.models.user import User
from app.schemas.competitor import (
    CompetitorAnalytics,
    CompetitorCreate,
    CompetitorDetail,
    CompetitorListItem,
    CompetitorUpdate,
    PostCreate,
    PostOut,
    ReportOut,
    SnapshotCreate,
    SnapshotOut,
)
from app.services import audit_service, competitor_report_service, competitor_service

router = APIRouter(prefix="/api/competitors", tags=["competitors"])

# Both roles may research; the workspace is shared.
AnyMember = Depends(require_role(Role.OWNER, Role.EDITOR))


@router.get("", response_model=list[CompetitorListItem])
async def list_competitors(db: DbSession, user: User = AnyMember) -> list[CompetitorListItem]:
    rows = await competitor_service.list_competitors(db, user.workspace_id)
    return [CompetitorListItem(**r) for r in rows]


@router.post("", response_model=CompetitorListItem, status_code=status.HTTP_201_CREATED)
async def create_competitor(
    payload: CompetitorCreate, db: DbSession, user: User = AnyMember
) -> CompetitorListItem:
    c = await competitor_service.create_competitor(
        db, user.workspace_id, created_by=user.id, **payload.model_dump()
    )
    await audit_service.record(
        db, workspace_id=user.workspace_id, user_id=user.id,
        action="competitor.create", entity=c.id, meta={"username": c.username},
    )
    await db.commit()
    return CompetitorListItem(
        id=c.id, username=c.username, display_name=c.display_name, category=c.category,
        profile_url=c.profile_url, avatar_url=c.avatar_url, latest_followers=None,
        avg_engagement_rate=None, follower_delta=None, follower_delta_pct=None,
        snapshot_count=0, post_count=0, report_count=0,
    )


@router.get("/{competitor_id}", response_model=CompetitorDetail)
async def get_competitor(
    competitor_id: str, db: DbSession, user: User = AnyMember
) -> CompetitorDetail:
    detail = await competitor_service.get_detail(db, user.workspace_id, competitor_id)
    return CompetitorDetail(**detail)


@router.patch("/{competitor_id}", response_model=CompetitorDetail)
async def update_competitor(
    competitor_id: str, payload: CompetitorUpdate, db: DbSession, user: User = AnyMember
) -> CompetitorDetail:
    await competitor_service.update_competitor(
        db, user.workspace_id, competitor_id, **payload.model_dump(exclude_unset=True)
    )
    await db.commit()
    detail = await competitor_service.get_detail(db, user.workspace_id, competitor_id)
    return CompetitorDetail(**detail)


@router.delete("/{competitor_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_competitor(
    competitor_id: str, db: DbSession, owner: User = Depends(require_role(Role.OWNER))
) -> None:
    await competitor_service.delete_competitor(db, owner.workspace_id, competitor_id)
    await audit_service.record(
        db, workspace_id=owner.workspace_id, user_id=owner.id,
        action="competitor.delete", entity=competitor_id,
    )
    await db.commit()


# --- snapshots ----------------------------------------------------

@router.post("/{competitor_id}/snapshots", response_model=SnapshotOut, status_code=status.HTTP_201_CREATED)
async def add_snapshot(
    competitor_id: str, payload: SnapshotCreate, db: DbSession, user: User = AnyMember
) -> SnapshotOut:
    snap = await competitor_service.add_snapshot(
        db, user.workspace_id, competitor_id, **payload.model_dump()
    )
    await db.commit()
    return SnapshotOut.model_validate(snap)


@router.delete("/{competitor_id}/snapshots/{snapshot_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_snapshot(
    competitor_id: str, snapshot_id: str, db: DbSession, user: User = AnyMember
) -> None:
    await competitor_service.delete_snapshot(db, user.workspace_id, snapshot_id)
    await db.commit()


# --- saved posts --------------------------------------------------

@router.post("/{competitor_id}/posts", response_model=PostOut, status_code=status.HTTP_201_CREATED)
async def add_post(
    competitor_id: str, payload: PostCreate, db: DbSession, user: User = AnyMember
) -> PostOut:
    post = await competitor_service.add_post(
        db, user.workspace_id, competitor_id, **payload.model_dump()
    )
    await db.commit()
    out = PostOut.model_validate(post)
    out.engagement = competitor_service._post_engagement(post)
    return out


@router.delete("/{competitor_id}/posts/{post_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_post(
    competitor_id: str, post_id: str, db: DbSession, user: User = AnyMember
) -> None:
    await competitor_service.delete_post(db, user.workspace_id, post_id)
    await db.commit()


# --- AI reports ---------------------------------------------------

@router.post("/{competitor_id}/report", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def generate_report(
    competitor_id: str, db: DbSession, user: User = AnyMember
) -> ReportOut:
    report = await competitor_report_service.generate_competitor_report(
        db, user.workspace_id, competitor_id, created_by=user.id
    )
    await audit_service.record(
        db, workspace_id=user.workspace_id, user_id=user.id,
        action="competitor.report", entity=competitor_id,
    )
    await db.commit()
    return ReportOut.model_validate(report)


@router.post("/report/overview", response_model=ReportOut, status_code=status.HTTP_201_CREATED)
async def generate_overview(db: DbSession, user: User = AnyMember) -> ReportOut:
    report = await competitor_report_service.generate_overview_report(
        db, user.workspace_id, created_by=user.id
    )
    await audit_service.record(
        db, workspace_id=user.workspace_id, user_id=user.id, action="competitor.report_overview",
    )
    await db.commit()
    return ReportOut.model_validate(report)
