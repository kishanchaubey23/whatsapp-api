/** Backend API base (enterprise auth / campaigns). */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') || 'http://localhost:4000';

export type AuthUser = {
  id: string;
  name: string;
  email: string;
  plan?: { code: string; priceInr?: number; active?: boolean };
};

export type AuthResponse = {
  success: boolean;
  token?: string;
  user?: AuthUser;
  error?: string | unknown;
};

export async function apiFetch<T = unknown>(
  path: string,
  options: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers, ...rest } = options;
  const res = await fetch(`${API_BASE}/api${path}`, {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
  });
  const data = (await res.json().catch(() => ({}))) as T & { success?: boolean; error?: string };
  if (!res.ok) {
    const err = typeof data === 'object' && data && 'error' in data ? data.error : res.statusText;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return data;
}
