from __future__ import annotations

from fastapi import APIRouter

from app.api.routes import (
    auth,
    board,
    competitors,
    connections,
    health,
    insights,
    media,
    safety,
    scheduling,
    workspace,
)

api_router = APIRouter()
api_router.include_router(health.router)
api_router.include_router(auth.router)
api_router.include_router(connections.router)
api_router.include_router(insights.router)
api_router.include_router(board.router)
api_router.include_router(scheduling.router)
api_router.include_router(safety.router)
api_router.include_router(workspace.router)
api_router.include_router(media.router)
api_router.include_router(competitors.router)
