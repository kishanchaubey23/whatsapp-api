import { API_BASE } from './api';

function token() {
  return localStorage.getItem('whatsflow_token') || sessionStorage.getItem('whatsflow_token');
}

async function req<T>(path: string, options: RequestInit = {}): Promise<T> {
  const t = token();
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = (data as { error?: unknown }).error ?? res.statusText;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return data as T;
}

export type AutoReplyKeyword = {
  id?: string;
  keyword: string;
  matchType: 'contains' | 'exact' | 'starts_with';
};

export type AutoReplyRule = {
  id: string;
  name: string;
  whatsappAccountId: string;
  priority: number;
  cooldownMinutes: number;
  responseBody: string;
  templateId: string | null;
  isActive: boolean;
  responseCount: number;
  createdAt: string;
  updatedAt: string;
  keywords: AutoReplyKeyword[];
  whatsappAccount?: {
    id: string;
    label: string;
    phone: string | null;
    status: string;
  };
};

export type AutoReplyStats = {
  totalRules: number;
  activeRules: number;
  inactiveRules: number;
  totalResponses: number;
};

export type AutoReplyRuleInput = {
  name: string;
  whatsappAccountId: string;
  priority: number;
  cooldownMinutes: number;
  responseBody: string;
  templateId?: string | null;
  isActive: boolean;
  keywords: Array<{ keyword: string; matchType: 'contains' | 'exact' | 'starts_with' }>;
};

export const autoReplyApi = {
  stats: () => req<{ success: boolean; stats: AutoReplyStats }>('/auto-reply/stats'),

  list: (params?: { q?: string; filter?: 'all' | 'active' | 'inactive' }) => {
    const sp = new URLSearchParams();
    if (params?.q) sp.set('q', params.q);
    if (params?.filter) sp.set('filter', params.filter);
    const q = sp.toString();
    return req<{ success: boolean; rules: AutoReplyRule[] }>(`/auto-reply/rules${q ? `?${q}` : ''}`);
  },

  create: (body: AutoReplyRuleInput) =>
    req<{ success: boolean; rule: AutoReplyRule }>('/auto-reply/rules', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  update: (id: string, body: AutoReplyRuleInput) =>
    req<{ success: boolean; rule: AutoReplyRule }>(`/auto-reply/rules/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  setActive: (id: string, isActive: boolean) =>
    req<{ success: boolean; rule: AutoReplyRule }>(`/auto-reply/rules/${id}/active`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  remove: (id: string) =>
    req<{ success: boolean }>(`/auto-reply/rules/${id}`, { method: 'DELETE' }),
};
