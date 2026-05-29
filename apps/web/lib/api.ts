"use client";

import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function rawFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function tryRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const resp = await rawFetch(
    "/api/auth/refresh",
    { method: "POST", body: JSON.stringify({ refresh_token: refresh }) },
    null,
  );
  if (!resp.ok) {
    clearTokens();
    return null;
  }
  const data = await resp.json();
  setTokens(data.access_token, data.refresh_token);
  return data.access_token as string;
}

/** Authenticated JSON fetch against our own backend. Auto-refreshes once on 401. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = getAccessToken();
  let resp = await rawFetch(path, init, token);

  if (resp.status === 401 && getRefreshToken()) {
    token = await tryRefresh();
    if (token) resp = await rawFetch(path, init, token);
  }

  if (resp.status === 204) return undefined as T;

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = body?.error ?? { code: "unknown", message: resp.statusText };
    throw new ApiError(resp.status, err.code, err.message);
  }
  return body as T;
}

export async function login(email: string, password: string): Promise<void> {
  const resp = await rawFetch(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    null,
  );
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = body?.error ?? { code: "unknown", message: "Login failed" };
    throw new ApiError(resp.status, err.code, err.message);
  }
  setTokens(body.access_token, body.refresh_token);
}

export interface Me {
  id: string;
  email: string;
  role: "OWNER" | "EDITOR";
  status: string;
  workspace_id: string;
}

export const getMe = () => apiFetch<Me>("/api/auth/me");
