from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.core.errors import AppError, app_error_handler, http_error_handler
from app.worker import publisher


@asynccontextmanager
async def lifespan(app: FastAPI):
    # The reloader spawns a parent process whose only job is to watch files; don't start
    # the scheduler there or we'd double-tick.
    if os.environ.get("RUN_MAIN") != "false":
        publisher.start()
    try:
        yield
    finally:
        await publisher.stop()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Titan OS API",
        version="0.1.0",
        description="Instagram creator-brand operations portal — official Graph API only.",
        lifespan=lifespan,
    )

    # CORS locked to exact app origins (Rail #2 / PRD §12). Never "*".
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(HTTPException, http_error_handler)

    app.include_router(api_router)
    return app


app = create_app()
