"""content board: board_column, board_card

Revision ID: 0003_board
Revises: 0002_ig_account
Create Date: 2026-05-29
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_board"
down_revision: str | None = "0002_ig_account"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "board_column",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("color", sa.String(), nullable=False, server_default="slate"),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], name="fk_board_column_workspace_id_workspace", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_board_column"),
    )
    op.create_index("ix_board_column_workspace_id", "board_column", ["workspace_id"])

    op.create_table(
        "board_card",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("workspace_id", sa.String(), nullable=False),
        sa.Column("column_id", sa.String(), nullable=False),
        sa.Column("title", sa.String(), nullable=False),
        sa.Column("notes", sa.String(), nullable=True),
        sa.Column("position", sa.Float(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(
            ["workspace_id"], ["workspace.id"], name="fk_board_card_workspace_id_workspace", ondelete="CASCADE"
        ),
        sa.ForeignKeyConstraint(
            ["column_id"], ["board_column.id"], name="fk_board_card_column_id_board_column", ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name="pk_board_card"),
    )
    op.create_index("ix_board_card_workspace_id", "board_card", ["workspace_id"])
    op.create_index("ix_board_card_column_id", "board_card", ["column_id"])


def downgrade() -> None:
    op.drop_table("board_card")
    op.drop_index("ix_board_column_workspace_id", table_name="board_column")
    op.drop_table("board_column")
