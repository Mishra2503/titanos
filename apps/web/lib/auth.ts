"use client";

// Auth state is now managed via httpOnly cookies set by the server.
// This file exposes only the client-readable auth check (cookie presence
// is not readable from JS — instead we check the /api/auth/me response).
// Token storage and handling is 100% server-side.

export function isAuthenticated(): boolean {
  // We can't read httpOnly cookies from JS — rely on the AuthContext/getMe call.
  // This returns true optimistically; the layout will redirect if the server says 401.
  return true;
}
