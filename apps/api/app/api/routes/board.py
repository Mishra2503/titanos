from __future__ import annotations

from fastapi import APIRouter, status

from app.api.deps import CurrentUser, DbSession
from app.schemas.board import (
    AiActionIn,
    AiOut,
    BoardOut,
    CardCreate,
    CardOut,
    CardUpdate,
    ColumnCreate,
    ColumnOut,
    ColumnUpdate,
    ReorderIn,
)
from app.services import ai_service, board_service

router = APIRouter(prefix="/api/board", tags=["board"])


@router.get("", response_model=BoardOut)
async def get_board(user: CurrentUser, db: DbSession) -> BoardOut:
    return BoardOut(columns=await board_service.get_board(db, user.workspace_id))


@router.post("/columns", response_model=ColumnOut, status_code=status.HTTP_201_CREATED)
async def create_column(payload: ColumnCreate, user: CurrentUser, db: DbSession) -> ColumnOut:
    col = await board_service.create_column(
        db, user.workspace_id, name=payload.name, color=payload.color
    )
    return ColumnOut.model_validate(col)


@router.patch("/columns/{column_id}", response_model=ColumnOut)
async def update_column(
    column_id: str, payload: ColumnUpdate, user: CurrentUser, db: DbSession
) -> ColumnOut:
    col = await board_service.update_column(
        db, user.workspace_id, column_id, name=payload.name, color=payload.color
    )
    return ColumnOut.model_validate(col)


@router.delete("/columns/{column_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_column(column_id: str, user: CurrentUser, db: DbSession) -> None:
    await board_service.delete_column(db, user.workspace_id, column_id)


@router.post("/columns/{column_id}/reorder", status_code=status.HTTP_204_NO_CONTENT)
async def reorder(column_id: str, payload: ReorderIn, user: CurrentUser, db: DbSession) -> None:
    await board_service.reorder_column(
        db, user.workspace_id, column_id, card_ids=payload.card_ids
    )


@router.post("/cards", response_model=CardOut, status_code=status.HTTP_201_CREATED)
async def create_card(payload: CardCreate, user: CurrentUser, db: DbSession) -> CardOut:
    data = payload.model_dump(exclude_unset=True)
    column_id = data.pop("column_id")
    title = data.pop("title")
    card = await board_service.create_card(
        db, user.workspace_id, column_id=column_id, title=title, payload=data
    )
    return CardOut.model_validate(card)


@router.patch("/cards/{card_id}", response_model=CardOut)
async def update_card(
    card_id: str, payload: CardUpdate, user: CurrentUser, db: DbSession
) -> CardOut:
    card = await board_service.update_card(
        db, user.workspace_id, card_id, payload=payload.model_dump(exclude_unset=True)
    )
    return CardOut.model_validate(card)


@router.delete("/cards/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(card_id: str, user: CurrentUser, db: DbSession) -> None:
    await board_service.delete_card(db, user.workspace_id, card_id)


@router.post("/cards/{card_id}/ai", response_model=AiOut)
async def card_ai_action(
    card_id: str, payload: AiActionIn, user: CurrentUser, db: DbSession
) -> AiOut:
    card = await board_service.get_card(db, user.workspace_id, card_id)
    text = await ai_service.run_card_action(
        card, action=payload.action, instruction=payload.instruction
    )
    return AiOut(action=payload.action, text=text)
