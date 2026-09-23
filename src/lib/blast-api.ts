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

export type BlastAccount = {
  id: string;
  label: string;
  phone: string | null;
  businessName: string | null;
  status: string;
  lastReadyAt?: string | null;
  createdAt?: string;
};

export type CreateBlastPayload = {
  whatsappAccountId: string;
  whatsappAccountIds?: string[];
  name?: string;
  messageBody?: string;
  kind?: 'verify' | 'send' | 'verify_and_send';
  selectionMethod: 'groups' | 'all_verified' | 'manual' | 'phones';
  groupIds?: string[];
  contactIds?: string[];
  phones?: string[];
  delaySeconds?: number;
  maxRetries?: number;
  scheduleType?: 'immediate' | 'later';
  scheduledAt?: string;
  messageType?: 'text' | 'template';
  templateId?: string;
  attachmentName?: string;
};

export type BlastBatch = {
  id: string;
  name?: string;
  status: string;
  kind: string;
  messageBody?: string | null;
  totalNumbers: number;
  processedCount: number;
  verifiedCount: number;
  sentCount: number;
  failedCount: number;
  skippedCount: number;
  lastError?: string | null;
  payload?: Record<string, unknown> | null;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  whatsappAccount?: {
    id: string;
    label: string;
    phone: string | null;
    status: string;
  };
};

export const blastApi = {
  listAccounts: () =>
    req<{ success: boolean; accounts: BlastAccount[]; live?: { accountId: string; status: string }[] }>(
      '/blast/accounts/list',
    ),

  createAccount: (label: string) =>
    req<{ success: boolean; account: BlastAccount }>('/blast/accounts', {
      method: 'POST',
      body: JSON.stringify({ label }),
    }),

  previewRecipients: (body: {
    selectionMethod: CreateBlastPayload['selectionMethod'];
    groupIds?: string[];
    contactIds?: string[];
    phones?: string[];
  }) =>
    req<{ success: boolean; count: number; sample: string[] }>('/blast/preview-recipients', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  create: (body: CreateBlastPayload) =>
    req<{
      success: boolean;
      batchId: string;
      status: string;
      totalNumbers: number;
      chunks: number;
      jobIds: string[];
    }>('/blast', { method: 'POST', body: JSON.stringify(body) }),

  list: () => req<{ success: boolean; batches: BlastBatch[] }>('/blast'),

  get: (batchId: string) =>
    req<{ success: boolean; batch: BlastBatch; queueCounts?: Record<string, number> }>(
      `/blast/${batchId}`,
    ),

  cancel: (batchId: string) =>
    req<{ success: boolean; batch: BlastBatch }>(`/blast/${batchId}/cancel`, { method: 'POST' }),
};
