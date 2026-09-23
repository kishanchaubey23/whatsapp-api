'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  contactsApi,
  type ContactGroup,
  type ContactInput,
  type ContactRow,
} from '@/lib/contacts-api';

type View = 'groups' | 'group';
type Modal =
  | { type: 'none' }
  | { type: 'newGroup' }
  | { type: 'manual' }
  | { type: 'paste' }
  | { type: 'excel' };

const emptyForm = (): ContactInput & { variables: Record<string, string> } => ({
  name: '',
  phone: '',
  email: '',
  company: '',
  position: '',
  tags: '',
  notes: '',
  variables: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`var${i + 1}`, ''])),
});

export default function ContactsPanel() {
  const [view, setView] = useState<View>('groups');
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [active, setActive] = useState<ContactGroup | null>(null);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [modal, setModal] = useState<Modal>({ type: 'none' });
  const [form, setForm] = useState(emptyForm);
  const [pasteText, setPasteText] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'verified' | 'unverified' | 'invalid' | 'blocked_or_unavailable'>('all');
  const [groupName, setGroupName] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3200);
  };

  const loadGroups = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await contactsApi.groups();
      setGroups(data.groups);
      if (active) {
        const g = data.groups.find((x) => x.id === active.id);
        if (g) setActive(g);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load groups');
    } finally {
      setLoading(false);
    }
  }, [active]);

  const loadContacts = useCallback(async (groupId: string) => {
    setBusy(true);
    try {
      const data = await contactsApi.list({
        groupId,
        status: statusFilter,
        q: search || undefined,
      });
      setContacts(data.contacts);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load contacts');
    } finally {
      setBusy(false);
    }
  }, [search, statusFilter]);

  useEffect(() => {
    void loadGroups();
  }, []);

  useEffect(() => {
    if (view === 'group' && active) void loadContacts(active.id);
  }, [view, active?.id, loadContacts]);

  const stats = useMemo(() => {
    if (active) return active.stats;
    return { total: 0, verified: 0, unverified: 0, invalid: 0 };
  }, [active]);

  async function createGroup() {
    if (!groupName.trim()) return;
    setBusy(true);
    try {
      const res = await contactsApi.createGroup(groupName.trim());
      setModal({ type: 'none' });
      setGroupName('');
      await loadGroups();
      setActive(res.group);
      setView('group');
      showToast('Group created');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function addContact() {
    if (!active) return;
    if (!form.name.trim() || !form.phone.trim()) {
      setError('Name and phone are required');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const vars: Record<string, string> = {};
      Object.entries(form.variables).forEach(([k, v]) => {
        if (v.trim()) vars[k] = v.trim();
      });
      await contactsApi.create({
        ...form,
        groupId: active.id,
        email: form.email || undefined,
        variables: vars,
      });
      setModal({ type: 'none' });
      setForm(emptyForm());
      await loadGroups();
      await loadContacts(active.id);
      showToast('Contact added');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add');
    } finally {
      setBusy(false);
    }
  }

  function parsePasteLines(text: string): ContactInput[] {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    const out: ContactInput[] = [];
    for (const line of lines) {
      // name,phone or phone only or name\tphone
      const parts = line.split(/[,\t|;]/).map((p) => p.trim());
      if (parts.length === 1) {
        out.push({ name: parts[0], phone: parts[0] });
      } else {
        const maybePhone = parts.find((p) => /\d{7,}/.test(p.replace(/\D/g, ''))) || parts[1];
        const name = parts[0] === maybePhone ? parts[0] : parts[0];
        out.push({
          name,
          phone: maybePhone,
          email: parts.find((p) => p.includes('@')),
        });
      }
    }
    return out;
  }

  async function importPaste() {
    if (!active) return;
    const rows = parsePasteLines(pasteText);
    if (!rows.length) {
      setError('No valid lines found');
      return;
    }
    setBusy(true);
    try {
      const res = await contactsApi.bulk(active.id, rows);
      setModal({ type: 'none' });
      setPasteText('');
      await loadGroups();
      await loadContacts(active.id);
      showToast(`Imported ${res.upserted} · skipped invalid ${res.invalid}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function importExcel(file: File) {
    if (!active) return;
    const text = await file.text();
    // Simple CSV parse
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      setError('CSV needs a header row and data');
      return;
    }
    const headers = lines[0].split(/[,;\t]/).map((h) => h.trim().toLowerCase().replace(/"/g, ''));
    const idx = (names: string[]) => headers.findIndex((h) => names.includes(h));
    const iName = idx(['name', 'full name', 'contact', 'fullname']);
    const iPhone = idx(['phone', 'mobile', 'number', 'whatsapp', 'phone number']);
    const iEmail = idx(['email', 'e-mail']);
    const iCompany = idx(['company', 'organization', 'org']);
    const iPos = idx(['position', 'title', 'job']);
    const iTags = idx(['tags', 'tag']);

    const rows: ContactInput[] = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(/[,;\t]/).map((c) => c.trim().replace(/^"|"$/g, ''));
      const phone = iPhone >= 0 ? cols[iPhone] : cols[1] || cols[0];
      if (!phone) continue;
      rows.push({
        name: (iName >= 0 ? cols[iName] : cols[0]) || phone,
        phone,
        email: iEmail >= 0 ? cols[iEmail] : undefined,
        company: iCompany >= 0 ? cols[iCompany] : undefined,
        position: iPos >= 0 ? cols[iPos] : undefined,
        tags: iTags >= 0 ? cols[iTags] : undefined,
      });
    }
    setBusy(true);
    try {
      const res = await contactsApi.bulk(active.id, rows);
      setModal({ type: 'none' });
      await loadGroups();
      await loadContacts(active.id);
      showToast(`Imported ${res.upserted} from file`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  }

  async function verifyWhatsApp() {
    if (!active) return;
    setBusy(true);
    setError('');
    setToast('Checking WhatsApp session…');
    try {
      // 1) Load full group (not only filtered table)
      const all = await contactsApi.list({ groupId: active.id });
      const list = all.contacts;
      if (!list.length) {
        showToast('No contacts to verify in this group');
        return;
      }

      // 2) Linked Business session required for live check
      const st = await fetch('/api/whatsapp/status').then((r) => r.json()) as {
        status?: string;
      };

      if (st.status !== 'ready') {
        // Format-only fallback
        const res = await contactsApi.verify(active.id);
        await loadGroups();
        await loadContacts(active.id);
        setError(
          'WhatsApp Business is not connected. Open Devices, link your Business account, then click Verify again for live checks.',
        );
        showToast(
          `Format only: ${res.invalid} invalid · ${res.unverified} still unverified (connect WA for live verify)`,
        );
        return;
      }

      // 3) Live check via whatsapp-web.js isRegisteredUser (batch)
      setToast(`Verifying ${list.length} numbers on WhatsApp…`);
      const phones = list.map((c) => c.phone);
      const results: Record<string, boolean> = {};
      const BATCH = 25;

      for (let i = 0; i < phones.length; i += BATCH) {
        const chunk = phones.slice(i, i + BATCH);
        setToast(`Verifying ${Math.min(i + chunk.length, phones.length)} / ${phones.length}…`);
        const v = await fetch('/api/whatsapp/validate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phones: chunk }),
        }).then(async (r) => {
          const j = await r.json();
          if (!r.ok || !j.success) {
            throw new Error(j.error || 'Validate request failed');
          }
          return j as { success: boolean; results: { phone: string; valid: boolean }[] };
        });

        for (const row of v.results) {
          results[row.phone] = row.valid;
        }
        // Gentle pace so WA does not rate-limit
        if (i + BATCH < phones.length) {
          await new Promise((r) => setTimeout(r, 400));
        }
      }

      // 4) Persist badges on backend
      const res = await contactsApi.verify(active.id, results);
      await loadGroups();
      await loadContacts(active.id);
      showToast(
        `WhatsApp check done: ${res.verified} on WhatsApp · ${res.invalid} not on WhatsApp / invalid`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Verify failed');
      setToast('');
    } finally {
      setBusy(false);
    }
  }

  async function deleteInvalid() {
    if (!active) return;
    if (!window.confirm('Delete all invalid contacts in this group?')) return;
    setBusy(true);
    try {
      const res = await contactsApi.deleteInvalid(active.id);
      await loadGroups();
      await loadContacts(active.id);
      showToast(`Deleted ${res.deleted} invalid`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  }

  async function deleteContact(id: string) {
    if (!window.confirm('Delete this contact?')) return;
    await contactsApi.remove(id);
    if (active) {
      await loadGroups();
      await loadContacts(active.id);
    }
  }

  // ─── Groups list view ─────────────────────────────────
  if (view === 'groups') {
    return (
      <div className="wf-ct">
        <div className="wf-devices-head">
          <div>
            <h1>Contacts</h1>
            <p>Organize contacts into groups for bulk messaging and verification.</p>
          </div>
          <button type="button" className="wf-add-device-btn" onClick={() => setModal({ type: 'newGroup' })}>
            + New Group
          </button>
        </div>

        {error && <div className="wf-ct-error">{error}</div>}
        {toast && <div className="wf-ct-toast">{toast}</div>}

        {loading ? (
          <p className="wf-ct-muted">Loading groups…</p>
        ) : groups.length === 0 ? (
          <div className="wf-dev-empty">
            <h2>No contact groups</h2>
            <p>Create a group, then add contacts manually, paste, or import CSV/Excel.</p>
            <button type="button" className="wf-add-device-btn" onClick={() => setModal({ type: 'newGroup' })}>
              + New Group
            </button>
          </div>
        ) : (
          <div className="wf-ct-groups">
            {groups.map((g) => (
              <button
                key={g.id}
                type="button"
                className="wf-ct-group-card"
                onClick={() => {
                  setActive(g);
                  setView('group');
                  setSearch('');
                  setStatusFilter('all');
                }}
              >
                <strong>{g.name}</strong>
                <span>{g.stats.total} contacts</span>
                <div className="wf-ct-mini-stats">
                  <em className="ok">{g.stats.verified} verified</em>
                  <em>{g.stats.unverified} pending</em>
                  <em className="bad">{g.stats.invalid} invalid</em>
                </div>
              </button>
            ))}
          </div>
        )}

        {modal.type === 'newGroup' && (
          <div className="wf-modal-backdrop">
            <div className="wf-modal">
              <div className="wf-modal-head">
                <h3>New group</h3>
                <button type="button" className="wf-modal-x" onClick={() => setModal({ type: 'none' })}>
                  ✕
                </button>
              </div>
              <input
                className="wf-modal-input"
                placeholder="Group name (e.g. Test)"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                autoFocus
              />
              <div className="wf-modal-actions">
                <button type="button" className="wf-btn ghost" onClick={() => setModal({ type: 'none' })}>
                  Cancel
                </button>
                <button type="button" className="wf-btn blue" disabled={busy} onClick={() => void createGroup()}>
                  Create
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─── Group detail view ────────────────────────────────
  return (
    <div className="wf-ct">
      <button type="button" className="wf-ct-back" onClick={() => { setView('groups'); setActive(null); }}>
        ← Back to Groups
      </button>

      <div className="wf-devices-head">
        <div>
          <h1>{active?.name || 'Group'}</h1>
          <p>Manage contacts in this group</p>
        </div>
        <div className="wf-ct-toolbar">
          <button type="button" className="wf-ct-tool" onClick={() => { setForm(emptyForm()); setModal({ type: 'manual' }); }}>
            + Manual Add
          </button>
          <button type="button" className="wf-ct-tool" onClick={() => setModal({ type: 'paste' })}>
            📋 Copy/Paste
          </button>
          <button type="button" className="wf-ct-tool" onClick={() => setModal({ type: 'excel' })}>
            📄 Excel Import
          </button>
          <button type="button" className="wf-ct-tool" disabled={busy} onClick={() => void verifyWhatsApp()}>
            🛡 Verify WhatsApp
          </button>
          <button type="button" className="wf-ct-tool danger" disabled={busy} onClick={() => void deleteInvalid()}>
            🗑 Delete Invalid
          </button>
        </div>
      </div>

      {error && <div className="wf-ct-error">{error}</div>}
      {toast && <div className="wf-ct-toast">{toast}</div>}

      <div className="wf-ct-stats">
        <div className="wf-ct-stat">
          <span>Total Contacts</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="wf-ct-stat ok">
          <span>Verified</span>
          <strong>{stats.verified}</strong>
        </div>
        <div className="wf-ct-stat warn">
          <span>Unverified</span>
          <strong>{stats.unverified}</strong>
        </div>
        <div className="wf-ct-stat bad">
          <span>Invalid</span>
          <strong>{stats.invalid}</strong>
        </div>
      </div>

      <div className="wf-ct-panel">
        <div className="wf-ct-panel-head">
          <h2>Contacts in {active?.name}</h2>
          <div className="wf-ct-filters">
            <input
              className="wf-ct-search"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && active && void loadContacts(active.id)}
            />
            <select
              className="wf-ct-select"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
            >
              <option value="all">All Status</option>
              <option value="verified">Verified</option>
              <option value="unverified">Unverified</option>
              <option value="invalid">Invalid</option>
              <option value="blocked_or_unavailable">Blocked / Unavailable</option>
            </select>
            <button type="button" className="wf-btn ghost" onClick={() => active && void loadContacts(active.id)}>
              Apply
            </button>
          </div>
        </div>

        {contacts.length === 0 ? (
          <div className="wf-ct-empty">
            <div className="wf-ct-empty-icon">👥</div>
            <strong>No contacts in this group</strong>
            <p>Get started by adding contacts to this group.</p>
          </div>
        ) : (
          <div className="wf-ct-table-wrap">
            <table className="wf-ct-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Company</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {contacts.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name || '—'}</td>
                    <td>+{c.phone}</td>
                    <td>{c.email || '—'}</td>
                    <td>{c.company || '—'}</td>
                    <td>
                      <span className={`wf-ct-badge ${c.waStatus}`}>{c.waStatus}</span>
                    </td>
                    <td>
                      <button type="button" className="wf-link-btn" onClick={() => void deleteContact(c.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manual add */}
      {modal.type === 'manual' && (
        <div className="wf-modal-backdrop">
          <div className="wf-modal wf-ct-modal">
            <div className="wf-modal-head">
              <h3>Add Contact to {active?.name}</h3>
              <button type="button" className="wf-modal-x" onClick={() => setModal({ type: 'none' })}>
                ✕
              </button>
            </div>
            <div className="wf-tpl-row2">
              <div>
                <label className="wf-tpl-label">Name *</label>
                <input className="wf-modal-input" placeholder="Contact name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="wf-tpl-label">Phone Number *</label>
                <input className="wf-modal-input" placeholder="e.g., +1234567890" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
            </div>
            <div className="wf-tpl-row2">
              <div>
                <label className="wf-tpl-label">Email</label>
                <input className="wf-modal-input" placeholder="email@example.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div>
                <label className="wf-tpl-label">Company</label>
                <input className="wf-modal-input" placeholder="Company name" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
              </div>
            </div>
            <div className="wf-tpl-row2">
              <div>
                <label className="wf-tpl-label">Position</label>
                <input className="wf-modal-input" placeholder="Job position" value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} />
              </div>
              <div>
                <label className="wf-tpl-label">Tags</label>
                <input className="wf-modal-input" placeholder="Comma-separated tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
              </div>
            </div>
            <label className="wf-tpl-label">Notes</label>
            <textarea className="wf-tpl-textarea" rows={3} placeholder="Additional notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            <label className="wf-tpl-label">Custom Variables</label>
            <div className="wf-ct-vars">
              {Array.from({ length: 10 }, (_, i) => {
                const k = `var${i + 1}`;
                return (
                  <div key={k}>
                    <span>Var{i + 1}</span>
                    <input
                      className="wf-modal-input"
                      placeholder={`Variable ${i + 1}`}
                      value={form.variables[k] || ''}
                      onChange={(e) =>
                        setForm({ ...form, variables: { ...form.variables, [k]: e.target.value } })
                      }
                    />
                  </div>
                );
              })}
            </div>
            {error && <p className="wf-modal-error">{error}</p>}
            <div className="wf-modal-actions">
              <button type="button" className="wf-btn ghost" onClick={() => setModal({ type: 'none' })}>
                Cancel
              </button>
              <button type="button" className="wf-btn blue" disabled={busy} onClick={() => void addContact()}>
                Add Contact
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Paste */}
      {modal.type === 'paste' && (
        <div className="wf-modal-backdrop">
          <div className="wf-modal">
            <div className="wf-modal-head">
              <h3>Copy / Paste contacts</h3>
              <button type="button" className="wf-modal-x" onClick={() => setModal({ type: 'none' })}>
                ✕
              </button>
            </div>
            <p className="wf-tpl-hint">One per line: <code>Name, +9198…</code> or phone only</p>
            <textarea className="wf-tpl-textarea" rows={10} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={'Rahul, +919876543210\n+919123456789'} />
            <div className="wf-modal-actions">
              <button type="button" className="wf-btn ghost" onClick={() => setModal({ type: 'none' })}>
                Cancel
              </button>
              <button type="button" className="wf-btn blue" disabled={busy} onClick={() => void importPaste()}>
                Import
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Excel/CSV */}
      {modal.type === 'excel' && (
        <div className="wf-modal-backdrop">
          <div className="wf-modal">
            <div className="wf-modal-head">
              <h3>Excel / CSV import</h3>
              <button type="button" className="wf-modal-x" onClick={() => setModal({ type: 'none' })}>
                ✕
              </button>
            </div>
            <p className="wf-tpl-hint">CSV with headers: name, phone, email, company, position, tags</p>
            <input
              type="file"
              accept=".csv,text/csv"
              className="wf-modal-input"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importExcel(f);
              }}
            />
            <div className="wf-modal-actions">
              <button type="button" className="wf-btn ghost" onClick={() => setModal({ type: 'none' })}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
