from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import not_found
from app.models.board import BoardCard, BoardColumn
from app.schemas.board import CardOut, ColumnOut

# Seeded once per workspace the first time the board is opened.
DEFAULT_COLUMNS = [
    ("Ideas", "slate"),
    ("In progress", "amber"),
    ("Editing", "rose"),
    ("Ready to post", "emerald"),
    ("Scheduled", "sky"),
]


async def _ensure_seeded(db: AsyncSession, workspace_id: str) -> None:
    count = await db.scalar(
        select(func.count()).select_from(BoardColumn).where(
            BoardColumn.workspace_id == workspace_id
        )
    )
    if count:
        return
    for i, (name, color) in enumerate(DEFAULT_COLUMNS):
        db.add(BoardColumn(workspace_id=workspace_id, name=name, color=color, position=i))
    await db.flush()


async def get_board(db: AsyncSession, workspace_id: str) -> list[ColumnOut]:
    await _ensure_seeded(db, workspace_id)
    columns = list(
        await db.scalars(
            select(BoardColumn)
            .where(BoardColumn.workspace_id == workspace_id)
            .order_by(BoardColumn.position)
        )
    )
    cards = list(
        await db.scalars(
            select(BoardCard)
            .where(BoardCard.workspace_id == workspace_id)
            .order_by(BoardCard.position)
        )
    )
    by_column: dict[str, list[CardOut]] = {c.id: [] for c in columns}
    for card in cards:
        by_column.setdefault(card.column_id, []).append(CardOut.model_validate(card))

    out: list[ColumnOut] = []
    for col in columns:
        model = ColumnOut.model_validate(col)
        model.cards = by_column.get(col.id, [])
        out.append(model)
    await db.commit()
    return out


async def _owned_column(db: AsyncSession, workspace_id: str, column_id: str) -> BoardColumn:
    col = await db.scalar(
        select(BoardColumn).where(
            BoardColumn.id == column_id, BoardColumn.workspace_id == workspace_id
        )
    )
    if col is None:
        raise not_found("Column not found")
    return col


async def _owned_card(db: AsyncSession, workspace_id: str, card_id: str) -> BoardCard:
    card = await db.scalar(
        select(BoardCard).where(
            BoardCard.id == card_id, BoardCard.workspace_id == workspace_id
        )
    )
    if card is None:
        raise not_found("Card not found")
    return card


async def create_column(db: AsyncSession, workspace_id: str, *, name: str, color: str) -> BoardColumn:
    max_pos = await db.scalar(
        select(func.max(BoardColumn.position)).where(BoardColumn.workspace_id == workspace_id)
    )
    col = BoardColumn(
        workspace_id=workspace_id, name=name, color=color, position=(max_pos or 0) + 1
    )
    db.add(col)
    await db.commit()
    return col


async def update_column(
    db: AsyncSession, workspace_id: str, column_id: str, *, name: str | None, color: str | None
) -> BoardColumn:
    col = await _owned_column(db, workspace_id, column_id)
    if name is not None:
        col.name = name
    if color is not None:
        col.color = color
    await db.commit()
    return col


async def delete_column(db: AsyncSession, workspace_id: str, column_id: str) -> None:
    col = await _owned_column(db, workspace_id, column_id)
    await db.delete(col)
    await db.commit()


_EDITABLE_FIELDS = (
    "title",
    "notes",
    "emoji",
    "status",
    "platforms",
    "publish_date",
    "hook",
    "visual_hook",
    "caption",
    "hashtags",
    "reference_url",
    "raw_footage_url",
    "cover_image_url",
)


def _apply_fields(card: BoardCard, payload: dict) -> None:
    for key in _EDITABLE_FIELDS:
        if key in payload and payload[key] is not None:
            setattr(card, key, payload[key])


async def create_card(
    db: AsyncSession, workspace_id: str, *, column_id: str, title: str, payload: dict
) -> BoardCard:
    await _owned_column(db, workspace_id, column_id)
    max_pos = await db.scalar(
        select(func.max(BoardCard.position)).where(BoardCard.column_id == column_id)
    )
    card = BoardCard(
        workspace_id=workspace_id,
        column_id=column_id,
        title=title,
        position=(max_pos or 0.0) + 1.0,
    )
    _apply_fields(card, payload)
    db.add(card)
    await db.commit()
    return card


async def update_card(
    db: AsyncSession, workspace_id: str, card_id: str, *, payload: dict
) -> BoardCard:
    card = await _owned_card(db, workspace_id, card_id)
    _apply_fields(card, payload)
    await db.commit()
    return card


async def get_card(db: AsyncSession, workspace_id: str, card_id: str) -> BoardCard:
    return await _owned_card(db, workspace_id, card_id)


async def delete_card(db: AsyncSession, workspace_id: str, card_id: str) -> None:
    card = await _owned_card(db, workspace_id, card_id)
    await db.delete(card)
    await db.commit()


async def reorder_column(
    db: AsyncSession, workspace_id: str, column_id: str, *, card_ids: list[str]
) -> None:
    """Persist a column's card order; cards dragged in from elsewhere are re-homed here."""
    await _owned_column(db, workspace_id, column_id)
    for index, card_id in enumerate(card_ids):
        card = await _owned_card(db, workspace_id, card_id)
        card.column_id = column_id
        card.position = float(index)
    await db.commit()
