import { NextResponse } from "next/server";

export function apiError(status: number, code: string, message: string) {
  return NextResponse.json({ error: { code, message } }, { status });
}

export const badRequest = (code: string, message: string) => apiError(400, code, message);
export const unauthorized = (message = "Unauthorized") => apiError(401, "unauthorized", message);
export const forbidden = (message = "Forbidden") => apiError(403, "forbidden", message);
export const notFound = (message = "Not found") => apiError(404, "not_found", message);
export const conflict = (code: string, message: string) => apiError(409, code, message);
export const serverError = (message = "Internal server error") =>
  apiError(500, "server_error", message);
