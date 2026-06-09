"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { ApiError, getMe, logout as apiLogout, type Me } from "@/lib/api";
import { useRouter } from "next/navigation";

interface AuthCtx {
  me: Me | null;
  loading: boolean;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const fetched = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await getMe();
      setMe(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        router.replace("/login");
      }
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (fetched.current) return;
    fetched.current = true;
    load();
  }, [load]);

  const logout = useCallback(async () => {
    await apiLogout().catch(() => {});
    setMe(null);
    router.replace("/login");
  }, [router]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await load();
  }, [load]);

  return <AuthContext.Provider value={{ me, loading, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
