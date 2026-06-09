from __future__ import annotations

import os

# Configure env BEFORE importing app settings (settings is cached at import).
os.environ.setdefault("JWT_SECRET", "test-secret-test-secret-test-secret")
os.environ.setdefault("FERNET_KEY", "")  # set below to a valid key
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite://")
os.environ.setdefault("CORS_ORIGINS", "http://localhost:3000")
# Force-clear IG creds so tests don't pick up a developer's real .env values.
os.environ["INSTAGRAM_APP_ID"] = ""
os.environ["INSTAGRAM_APP_SECRET"] = ""
# Disable account-safety guardrails by default so existing tests can schedule
# closely-spaced posts. Safety tests turn it back on explicitly.
os.environ["SAFETY_ENABLED"] = "false"

from cryptography.fernet import Fernet  # noqa: E402

os.environ["FERNET_KEY"] = Fernet.generate_key().decode()

import pytest_asyncio  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.api.deps import get_db  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.main import create_app  # noqa: E402
from app.models.enums import Role, UserStatus  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.workspace import Workspace  # noqa: E402
from app.core.security import hash_password  # noqa: E402


@pytest_asyncio.fixture
async def engine():
    eng = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def session_factory(engine):
    return async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


@pytest_asyncio.fixture
async def client(engine, session_factory):
    app = create_app()

    async def _get_db():
        async with session_factory() as s:
            yield s

    app.dependency_overrides[get_db] = _get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest_asyncio.fixture
async def workspace(session_factory):
    async with session_factory() as s:
        ws = Workspace(name="Test WS")
        s.add(ws)
        await s.commit()
        return ws.id


@pytest_asyncio.fixture
async def owner(session_factory, workspace):
    async with session_factory() as s:
        u = User(
            workspace_id=workspace,
            email="owner@test.com",
            password_hash=hash_password("ownerpass123"),
            role=Role.OWNER,
            status=UserStatus.ACTIVE,
        )
        s.add(u)
        await s.commit()
        return u


@pytest_asyncio.fixture
async def editor(session_factory, workspace):
    async with session_factory() as s:
        u = User(
            workspace_id=workspace,
            email="editor@test.com",
            password_hash=hash_password("editorpass123"),
            role=Role.EDITOR,
            status=UserStatus.ACTIVE,
        )
        s.add(u)
        await s.commit()
        return u


async def _login(client, email: str, password: str) -> str:
    resp = await client.post("/api/auth/login", json={"email": email, "password": password})
    assert resp.status_code == 200, resp.text
    return resp.json()["access_token"]
