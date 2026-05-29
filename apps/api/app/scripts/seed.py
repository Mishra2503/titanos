"""Seed the single MVP workspace + an OWNER user (idempotent).

Usage:
    python -m app.scripts.seed --email you@example.com --password 'strong-pass' --workspace "Titan OS"
"""
from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select

from app.core.security import hash_password
from app.db.session import SessionLocal
from app.models.enums import Role, UserStatus
from app.models.user import User
from app.models.workspace import Workspace


async def seed(email: str, password: str, workspace_name: str) -> None:
    email = email.lower()
    async with SessionLocal() as db:
        workspace = await db.scalar(select(Workspace).limit(1))
        if workspace is None:
            workspace = Workspace(name=workspace_name)
            db.add(workspace)
            await db.flush()
            print(f"Created workspace {workspace.id} ({workspace_name})")
        else:
            print(f"Workspace already exists: {workspace.id}")

        existing = await db.scalar(
            select(User).where(User.workspace_id == workspace.id, User.email == email)
        )
        if existing is not None:
            print(f"Owner {email} already exists; nothing to do.")
            return

        db.add(
            User(
                workspace_id=workspace.id,
                email=email,
                password_hash=hash_password(password),
                role=Role.OWNER,
                status=UserStatus.ACTIVE,
            )
        )
        await db.commit()
        print(f"Created OWNER {email}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--email", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--workspace", default="Titan OS")
    args = parser.parse_args()
    asyncio.run(seed(args.email, args.password, args.workspace))


if __name__ == "__main__":
    main()
