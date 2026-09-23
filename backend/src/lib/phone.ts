/**
 * Shared phone normalization — single source of truth for the entire backend.
 * Canonical form: digits only (E.164 without leading +), 7–15 digits.
 */

export type NormalizedPhone = string;

/** Strip formatting; return digits-only or null if invalid length. */
export function normalizePhone(raw: string | null | undefined): NormalizedPhone | null {
  if (raw == null) return null;
  const digits = String(raw).replace(/[\s\-\(\)\.\+]/g, '').replace(/\D/g, '');
  if (!/^\d{7,15}$/.test(digits)) return null;
  return digits;
}

/** Strict format check after normalize (country + national). */
export function isPhoneFormatValid(phone: NormalizedPhone): boolean {
  return /^\d{10,15}$/.test(phone);
}

/** Display helper — never use for keys. */
export function formatPhoneDisplay(phone: NormalizedPhone): string {
  return `+${phone}`;
}

export function toWhatsAppChatId(phone: NormalizedPhone): string {
  return `${phone}@c.us`;
}

/** Log-safe phone (no full MSISDN in logs). */
export function maskPhone(raw: string | null | undefined): string {
  const p = normalizePhone(raw ?? '') ?? String(raw ?? '');
  if (p.length < 6) return '***';
  return `${p.slice(0, 3)}***${p.slice(-3)}`;
}
