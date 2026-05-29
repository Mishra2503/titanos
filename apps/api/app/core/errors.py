from __future__ import annotations

from fastapi import HTTPException, Request, status
from fastapi.responses import JSONResponse


class AppError(HTTPException):
    """HTTP error carrying a stable machine-readable code.

    Serialized to the consistent envelope {"error": {"code", "message"}} (PRD §10).
    """

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(status_code=status_code, detail=message)
        self.code = code


def unauthorized(message: str = "Not authenticated") -> AppError:
    return AppError(status.HTTP_401_UNAUTHORIZED, "unauthorized", message)


def forbidden(message: str = "Insufficient permissions") -> AppError:
    return AppError(status.HTTP_403_FORBIDDEN, "forbidden", message)


def not_found(message: str = "Not found") -> AppError:
    return AppError(status.HTTP_404_NOT_FOUND, "not_found", message)


def bad_request(code: str, message: str) -> AppError:
    return AppError(status.HTTP_400_BAD_REQUEST, code, message)


def conflict(code: str, message: str) -> AppError:
    return AppError(status.HTTP_409_CONFLICT, code, message)


async def app_error_handler(_: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.detail}},
    )


async def http_error_handler(_: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": "http_error", "message": exc.detail}},
    )
