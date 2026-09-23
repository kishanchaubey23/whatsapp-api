import Papa from 'papaparse';

export interface Contact {
  email?: string;
  phone?: string;
  [key: string]: string | undefined;
}

const CONTACTS_KEY = 'contacts';
const CONTACTS_EXPIRY_KEY = 'contactsExpiry';
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_CONTACTS_WARNING = 5000;

export function parseCSV(file: File): Promise<{ headers: string[]; contacts: Contact[] }> {
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        const headers = results.meta.fields ?? [];
        const contacts: Contact[] = results.data.map((row) => {
          const contact: Contact = {};
          for (const key of headers) {
            contact[key] = row[key] ?? '';
          }
          // Normalize phone: strip +, spaces, dashes
          if (contact.phone) {
            contact.phone = contact.phone.replace(/[\s\-+]/g, '');
          }
          return contact;
        });
        if (contacts.length > MAX_CONTACTS_WARNING) {
          console.warn(`[BulkSender] CSV has ${contacts.length} contacts — approaching chrome.storage.local 10 MB limit.`);
        }
        resolve({ headers, contacts });
      },
      error: (err: Error) => reject(err),
    });
  });
}

export async function saveContactsToStorage(contacts: Contact[]): Promise<void> {
  return new Promise((resolve) => {
    const expiry = Date.now() + TTL_MS;
    chrome.storage.local.set({ [CONTACTS_KEY]: contacts, [CONTACTS_EXPIRY_KEY]: expiry }, resolve);
  });
}

export async function loadContactsFromStorage(): Promise<Contact[] | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([CONTACTS_KEY, CONTACTS_EXPIRY_KEY], (result) => {
      const expiry = result[CONTACTS_EXPIRY_KEY] as number | undefined;
      if (!expiry || Date.now() > expiry) {
        // Expired or missing — clear and return null
        chrome.storage.local.remove([CONTACTS_KEY, CONTACTS_EXPIRY_KEY], () => resolve(null));
      } else {
        resolve((result[CONTACTS_KEY] as Contact[]) ?? null);
      }
    });
  });
}

/**
 * Resolve {{Variable}} placeholders using contact data.
 * Strips HTML tags from values to prevent injection.
 */
export function resolveTemplate(template: string, contact: Contact): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const value = contact[key] ?? contact[key.toLowerCase()] ?? '';
    // Strip HTML tags (not escape — messages are inserted as plain text)
    return String(value).replace(/<[^>]*>/g, '');
  });
}

/**
 * Resolve spin syntax: {A|B|C} → one random option.
 */
export function resolveSpin(template: string): string {
  return template.replace(/\{([^{}|]+(?:\|[^{}|]+)+)\}/g, (_, options: string) => {
    const choices = options.split('|');
    return choices[Math.floor(Math.random() * choices.length)];
  });
}

/**
 * Apply ±jitter to a base delay (−30% … +50%).
 * Floor is 1s or 50% of base so turbo/custom fast paces remain usable.
 */
export function applyJitter(baseDelayMs: number): number {
  const jitterFactor = -0.3 + Math.random() * 0.8;
  const jittered = baseDelayMs * (1 + jitterFactor);
  const floor = Math.max(1000, Math.round(baseDelayMs * 0.5));
  return Math.max(floor, Math.round(jittered));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
