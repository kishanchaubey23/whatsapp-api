'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { apiFetch, type AuthUser } from './api';

const TOKEN_KEY = 'whatsflow_token';
const USER_KEY = 'whatsflow_user';
const REMEMBER_KEY = 'whatsflow_remember';

type AuthContextValue = {
  user: AuthUser | null;
  token: string | null;
  loading: boolean;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  register: (name: string, email: string, password: string, phone?: string) => Promise<void>;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const persist = useCallback((t: string, u: AuthUser, remember: boolean) => {
    const store = remember ? localStorage : sessionStorage;
    const other = remember ? sessionStorage : localStorage;
    other.removeItem(TOKEN_KEY);
    other.removeItem(USER_KEY);
    store.setItem(TOKEN_KEY, t);
    store.setItem(USER_KEY, JSON.stringify(u));
    localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
    setToken(t);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    setToken(null);
    setUser(null);
  }, []);

  const refreshMe = useCallback(async () => {
    const t =
      localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    if (!t) {
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch<{ success: boolean; user: AuthUser }>('/auth/me', { token: t });
      setToken(t);
      setUser(data.user);
      const remember = localStorage.getItem(REMEMBER_KEY) === '1';
      const store = remember ? localStorage : sessionStorage;
      store.setItem(USER_KEY, JSON.stringify(data.user));
    } catch {
      logout();
    } finally {
      setLoading(false);
    }
  }, [logout]);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY);
    const raw = localStorage.getItem(USER_KEY) || sessionStorage.getItem(USER_KEY);
    if (t && raw) {
      try {
        setToken(t);
        setUser(JSON.parse(raw) as AuthUser);
      } catch {
        /* ignore */
      }
    }
    void refreshMe();
  }, [refreshMe]);

  const login = useCallback(
    async (email: string, password: string, remember: boolean) => {
      const data = await apiFetch<{ success: boolean; token: string; user: AuthUser }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      if (!data.token || !data.user) throw new Error('Invalid login response');
      persist(data.token, data.user, remember);
    },
    [persist],
  );

  const register = useCallback(
    async (name: string, email: string, password: string, phone?: string) => {
      const data = await apiFetch<{ success: boolean; token: string; user: AuthUser }>('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ name, email, password, phone }),
      });
      if (!data.token || !data.user) throw new Error('Invalid register response');
      persist(data.token, data.user, true);
    },
    [persist],
  );

  const value = useMemo(
    () => ({ user, token, loading, login, register, logout, refreshMe }),
    [user, token, loading, login, register, logout, refreshMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
