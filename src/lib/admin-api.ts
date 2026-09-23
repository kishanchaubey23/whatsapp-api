import { API_BASE } from './api';

const TOKEN_KEY = 'whatsflow_admin_token';

export function getAdminToken() {
  return typeof window !== 'undefined' ? localStorage.getItem(TOKEN_KEY) : null;
}

export function setAdminToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function adminReq<T>(path: string, options: RequestInit = {}): Promise<T> {
  const t = getAdminToken();
  const res = await fetch(`${API_BASE}/api/admin${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: string }).error || res.statusText;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return data as T;
}

export type AdminStats = {
  users: {
    total: number;
    active: number;
    inactiveOrPlanOff: number;
    withBannedWhatsApp: number;
  };
  whatsapp: { bannedOrTerminatedAccounts: number };
  messages: {
    successful: number;
    failed: number;
    deliveredOrRead: number;
    pending: number;
    blastSent: number;
    blastFailed: number;
    blastVerified: number;
    blastTotal: number;
    blastSkipped: number;
  };
  campaigns: { totalBatches: number };
};

export type AdminUserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  isActive: boolean;
  planActive: boolean;
  planCode: string;
  planPriceInr: number;
  createdAt: string;
  lastLoginAt: string | null;
  counts: {
    messages: number;
    blastBatches: number;
    whatsappAccounts: number;
    contacts: number;
  };
  hasBannedWhatsApp: boolean;
};

export const adminApi = {
  login: (email: string, password: string) =>
    adminReq<{ success: boolean; token: string; admin: { email: string } }>('/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  stats: () => adminReq<{ success: boolean; stats: AdminStats }>('/stats'),

  users: (params?: { q?: string; page?: number; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    const q = sp.toString();
    return adminReq<{ success: boolean; users: AdminUserRow[]; total: number; page: number }>(
      `/users${q ? `?${q}` : ''}`,
    );
  },

  user: (id: string) =>
    adminReq<{
      success: boolean;
      user: AdminUserRow & {
        whatsappAccounts: Array<{
          id: string;
          label: string;
          phone: string | null;
          businessName: string | null;
          status: string;
          riskScore: number;
          lastReadyAt: string | null;
          lastError: string | null;
          createdAt: string;
        }>;
        payments: Array<{
          id: string;
          amountInr: number;
          currency: string;
          status: string;
          method: string | null;
          reference: string | null;
          note: string | null;
          paidAt: string | null;
          createdAt: string;
        }>;
        blastBatches: Array<{
          id: string;
          status: string;
          kind: string;
          totalNumbers: number;
          sentCount: number;
          failedCount: number;
          createdAt: string;
          payload?: unknown;
        }>;
        messageStats: Record<string, number>;
        _count: Record<string, number>;
      };
    }>(`/users/${id}`),

  deactivatePlan: (id: string, planActive: boolean, deactivateAccount?: boolean) =>
    adminReq<{ success: boolean; user: { id: string; planActive: boolean; isActive: boolean } }>(
      `/users/${id}/deactivate-plan`,
      {
        method: 'POST',
        body: JSON.stringify({ planActive, deactivateAccount }),
      },
    ),

  setActive: (id: string, isActive: boolean) =>
    adminReq<{ success: boolean }>(`/users/${id}/set-active`, {
      method: 'POST',
      body: JSON.stringify({ isActive }),
    }),

  addPayment: (
    id: string,
    body: { amountInr?: number; status?: string; method?: string; note?: string; reference?: string },
  ) =>
    adminReq<{ success: boolean }>(`/users/${id}/payments`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};
