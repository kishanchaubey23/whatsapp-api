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
    const err = (data as { error?: string }).error || res.statusText;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return data as T;
}

export type GroupStats = { total: number; verified: number; unverified: number; invalid: number };

export type ContactGroup = {
  id: string;
  name: string;
  description?: string | null;
  createdAt: string;
  stats: GroupStats;
};

export type ContactRow = {
  id: string;
  name: string | null;
  phone: string;
  email: string | null;
  company?: string | null;
  position?: string | null;
  tags?: string | null;
  notes?: string | null;
  variables?: Record<string, string> | null;
  groupId?: string | null;
  waStatus: 'verified' | 'unverified' | 'invalid' | 'blocked_or_unavailable';
  createdAt: string;
};

export type ContactInput = {
  name: string;
  phone: string;
  email?: string;
  company?: string;
  position?: string;
  tags?: string;
  notes?: string;
  groupId?: string | null;
  variables?: Record<string, string>;
};

export const contactsApi = {
  groups: () => req<{ success: boolean; groups: ContactGroup[] }>('/contacts/groups'),
  createGroup: (name: string, description?: string) =>
    req<{ success: boolean; group: ContactGroup }>('/contacts/groups', {
      method: 'POST',
      body: JSON.stringify({ name, description }),
    }),
  deleteGroup: (id: string) =>
    req<{ success: boolean }>(`/contacts/groups/${id}`, { method: 'DELETE' }),
  list: (params: { groupId?: string; status?: string; q?: string }) => {
    const sp = new URLSearchParams();
    if (params.groupId) sp.set('groupId', params.groupId);
    if (params.status && params.status !== 'all') sp.set('status', params.status);
    if (params.q) sp.set('q', params.q);
    const q = sp.toString();
    return req<{ success: boolean; contacts: ContactRow[] }>(`/contacts${q ? `?${q}` : ''}`);
  },
  create: (body: ContactInput) =>
    req<{ success: boolean; contact: ContactRow }>('/contacts', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  bulk: (groupId: string | null | undefined, contacts: ContactInput[]) =>
    req<{ success: boolean; upserted: number; invalid: number }>('/contacts/bulk', {
      method: 'POST',
      body: JSON.stringify({ groupId, contacts }),
    }),
  remove: (id: string) => req<{ success: boolean }>(`/contacts/${id}`, { method: 'DELETE' }),
  deleteInvalid: (groupId?: string) =>
    req<{ success: boolean; deleted: number }>('/contacts/delete-invalid', {
      method: 'POST',
      body: JSON.stringify({ groupId }),
    }),
  verify: (groupId?: string, results?: Record<string, boolean>) =>
    req<{ success: boolean; verified: number; invalid: number; unverified: number; total: number }>(
      '/contacts/verify',
      { method: 'POST', body: JSON.stringify({ groupId, results }) },
    ),
};
