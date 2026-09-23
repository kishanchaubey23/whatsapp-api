'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { blastApi, type BlastAccount } from '@/lib/blast-api';
import {
  autoReplyApi,
  type AutoReplyRule,
  type AutoReplyStats,
  type AutoReplyRuleInput,
} from '@/lib/auto-reply-api';

type Template = { id: string; name: string; body: string };

const TEMPLATES_KEY = 'whatsflow_templates_v1';

function loadTemplates(): Template[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as Template[]) : [];
  } catch {
    return [];
  }
}

type FormState = {
  name: string;
  whatsappAccountId: string;
  priority: number;
  cooldownMinutes: number;
  responseBody: string;
  templateId: string;
  isActive: boolean;
  keywordsText: string;
  matchType: 'contains' | 'exact' | 'starts_with';
};

const emptyForm = (): FormState => ({
  name: '',
  whatsappAccountId: '',
  priority: 1,
  cooldownMinutes: 0,
  responseBody: '',
  templateId: '',
  isActive: true,
  keywordsText: '',
  matchType: 'contains',
});

function formFromRule(r: AutoReplyRule): FormState {
  return {
    name: r.name,
    whatsappAccountId: r.whatsappAccountId,
    priority: r.priority,
    cooldownMinutes: r.cooldownMinutes,
    responseBody: r.responseBody,
    templateId: r.templateId || '',
    isActive: r.isActive,
    keywordsText: r.keywords.map((k) => k.keyword).join(', '),
    matchType: (r.keywords[0]?.matchType as FormState['matchType']) || 'contains',
  };
}

function toInput(f: FormState): AutoReplyRuleInput {
  const keywords = f.keywordsText
    .split(/[,|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((keyword) => ({ keyword, matchType: f.matchType }));
  return {
    name: f.name.trim(),
    whatsappAccountId: f.whatsappAccountId,
    priority: Number(f.priority) || 1,
    cooldownMinutes: Math.max(0, Number(f.cooldownMinutes) || 0),
    responseBody: f.responseBody.trim(),
    templateId: f.templateId || null,
    isActive: f.isActive,
    keywords,
  };
}

export default function AutoReplyPanel() {
  const [stats, setStats] = useState<AutoReplyStats | null>(null);
  const [rules, setRules] = useState<AutoReplyRule[]>([]);
  const [accounts, setAccounts] = useState<BlastAccount[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState<'none' | 'create' | 'edit'>('none');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [s, r, a] = await Promise.all([
        autoReplyApi.stats(),
        autoReplyApi.list({ q: q || undefined, filter }),
        blastApi.listAccounts(),
      ]);
      setStats(s.stats);
      setRules(r.rules);
      setAccounts(a.accounts || []);
      setTemplates(loadTemplates());
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load auto-reply data');
    } finally {
      setLoading(false);
    }
  }, [q, filter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredEmpty = !loading && rules.length === 0;

  const accountLabel = useMemo(() => {
    const m = new Map(accounts.map((a) => [a.id, a]));
    return (id: string) => {
      const a = m.get(id);
      if (!a) return 'Session';
      return a.phone ? `${a.label} (+${a.phone})` : a.label;
    };
  }, [accounts]);

  function openCreate() {
    const f = emptyForm();
    if (accounts[0]) f.whatsappAccountId = accounts[0].id;
    setForm(f);
    setEditingId(null);
    setModal('create');
  }

  function openEdit(r: AutoReplyRule) {
    setForm(formFromRule(r));
    setEditingId(r.id);
    setModal('edit');
  }

  function onTemplatePick(id: string) {
    const t = templates.find((x) => x.id === id);
    setForm((prev) => ({
      ...prev,
      templateId: id,
      responseBody: t?.body ?? prev.responseBody,
    }));
  }

  async function submitForm(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) {
      setError('Rule name is required');
      return;
    }
    if (!form.whatsappAccountId) {
      setError('Select a WhatsApp session');
      return;
    }
    if (!form.responseBody.trim()) {
      setError('Auto reply response is required');
      return;
    }
    setBusy(true);
    try {
      const body = toInput(form);
      if (editingId) await autoReplyApi.update(editingId, body);
      else await autoReplyApi.create(body);
      setModal('none');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(r: AutoReplyRule) {
    setBusy(true);
    try {
      await autoReplyApi.setActive(r.id, !r.isActive);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setBusy(false);
    }
  }

  async function removeRule(r: AutoReplyRule) {
    if (!window.confirm(`Delete rule “${r.name}”?`)) return;
    setBusy(true);
    try {
      await autoReplyApi.remove(r.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wf-page ar-page">
      <div className="wf-page-head">
        <div>
          <h1>Auto Reply</h1>
          <p>Set up automatic keyword-based responses</p>
        </div>
        <div className="wf-page-actions">
          <button type="button" className="wf-btn ghost" onClick={() => void load()} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="wf-btn blue" onClick={openCreate}>
            + Create Rule
          </button>
        </div>
      </div>

      {error && <div className="wf-alert error">{error}</div>}

      <div className="wf-stats ar-stats">
        <div className="wf-stat-card">
          <div className="wf-stat-top">
            <span className="wf-stat-label">Total Rules</span>
            <span className="wf-stat-icon" style={{ color: '#2563eb' }}>
              💬
            </span>
          </div>
          <div className="wf-stat-value">{stats?.totalRules ?? 0}</div>
        </div>
        <div className="wf-stat-card">
          <div className="wf-stat-top">
            <span className="wf-stat-label">Active Rules</span>
            <span className="wf-stat-icon" style={{ color: '#16a34a' }}>
              ▶
            </span>
          </div>
          <div className="wf-stat-value">{stats?.activeRules ?? 0}</div>
        </div>
        <div className="wf-stat-card">
          <div className="wf-stat-top">
            <span className="wf-stat-label">Inactive Rules</span>
            <span className="wf-stat-icon" style={{ color: '#d97706' }}>
              ❚❚
            </span>
          </div>
          <div className="wf-stat-value">{stats?.inactiveRules ?? 0}</div>
        </div>
        <div className="wf-stat-card">
          <div className="wf-stat-top">
            <span className="wf-stat-label">Total Responses</span>
            <span className="wf-stat-icon" style={{ color: '#7c3aed' }}>
              ✓
            </span>
          </div>
          <div className="wf-stat-value">{stats?.totalResponses ?? 0}</div>
        </div>
      </div>

      <div className="ar-toolbar">
        <input
          className="ar-search"
          placeholder="Search rules…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void load()}
        />
        <select
          className="ar-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as typeof filter)}
        >
          <option value="all">All Rules</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      {loading ? (
        <p className="wf-muted">Loading rules…</p>
      ) : filteredEmpty ? (
        <div className="ar-empty">
          <div className="ar-empty-icon">💬</div>
          <h3>No auto reply rules yet</h3>
          <p>Create your first auto reply rule to start automating responses</p>
          <button type="button" className="wf-btn blue" onClick={openCreate}>
            + Create Rule
          </button>
          {accounts.length === 0 && (
            <p className="wf-muted" style={{ marginTop: 12 }}>
              Tip: register a WhatsApp session under <Link href="/dashboard/devices">Devices</Link> /
              blast accounts first.
            </p>
          )}
        </div>
      ) : (
        <div className="ar-list">
          {rules.map((r) => (
            <div key={r.id} className="ar-card">
              <div className="ar-card-main">
                <div className="ar-card-title">
                  <strong>{r.name}</strong>
                  <span className={`ar-badge ${r.isActive ? 'on' : 'off'}`}>
                    {r.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <div className="ar-card-meta">
                  <span>Session: {accountLabel(r.whatsappAccountId)}</span>
                  <span>Priority: {r.priority}</span>
                  <span>Cooldown: {r.cooldownMinutes}m</span>
                  <span>Sent: {r.responseCount}</span>
                </div>
                <div className="ar-card-kw">
                  {r.keywords.length === 0 ? (
                    <em>Any message</em>
                  ) : (
                    r.keywords.map((k) => (
                      <span key={k.id || k.keyword} className="ar-kw">
                        {k.keyword}
                      </span>
                    ))
                  )}
                </div>
                <p className="ar-card-body">{r.responseBody}</p>
              </div>
              <div className="ar-card-actions">
                <button type="button" className="wf-btn ghost" disabled={busy} onClick={() => openEdit(r)}>
                  Edit
                </button>
                <button
                  type="button"
                  className={`wf-btn ${r.isActive ? 'orange' : 'green'}`}
                  disabled={busy}
                  onClick={() => void toggleActive(r)}
                >
                  {r.isActive ? 'Disable' : 'Enable'}
                </button>
                <button type="button" className="wf-btn red" disabled={busy} onClick={() => void removeRule(r)}>
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal !== 'none' && (
        <div className="wf-modal-backdrop" role="presentation" onClick={() => setModal('none')}>
          <div
            className="wf-modal wide ar-modal"
            role="dialog"
            aria-labelledby="ar-modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="ar-modal-head">
              <h3 id="ar-modal-title">{modal === 'edit' ? 'Edit Auto Reply Rule' : 'Create Auto Reply Rule'}</h3>
              <button type="button" className="ar-close" onClick={() => setModal('none')} aria-label="Close">
                ×
              </button>
            </div>
            <form onSubmit={(e) => void submitForm(e)}>
              <div className="ar-form-grid">
                <label>
                  <span>Rule Name *</span>
                  <input
                    required
                    placeholder="e.g., Welcome Message"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                  />
                </label>
                <label>
                  <span>WhatsApp Session *</span>
                  <select
                    required
                    value={form.whatsappAccountId}
                    onChange={(e) => setForm({ ...form, whatsappAccountId: e.target.value })}
                  >
                    <option value="">Select a session</option>
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label}
                        {a.phone ? ` (+${a.phone})` : ''} · {a.status}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <label className="ar-field">
                <span>Priority</span>
                <input
                  type="number"
                  min={0}
                  value={form.priority}
                  onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })}
                />
                <small>Lower numbers = higher priority</small>
              </label>

              <label className="ar-field">
                <span>Cooldown Period (minutes)</span>
                <input
                  type="number"
                  min={0}
                  value={form.cooldownMinutes}
                  onChange={(e) => setForm({ ...form, cooldownMinutes: Number(e.target.value) })}
                />
                <small>Minimum time between auto-replies to the same user (0 = no cooldown)</small>
              </label>

              <label className="ar-field">
                <span>Keywords (optional)</span>
                <input
                  placeholder="hello, hi, price — comma separated"
                  value={form.keywordsText}
                  onChange={(e) => setForm({ ...form, keywordsText: e.target.value })}
                />
                <small>Empty = reply to any inbound private message</small>
              </label>

              <label className="ar-field">
                <span>Match type</span>
                <select
                  value={form.matchType}
                  onChange={(e) =>
                    setForm({ ...form, matchType: e.target.value as FormState['matchType'] })
                  }
                >
                  <option value="contains">Contains</option>
                  <option value="exact">Exact</option>
                  <option value="starts_with">Starts with</option>
                </select>
              </label>

              <label className="ar-field">
                <span>Template (Optional)</span>
                <select value={form.templateId} onChange={(e) => onTemplatePick(e.target.value)}>
                  <option value="">Select a template or write custom response</option>
                  {templates.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="ar-field">
                <span>Auto Reply Response *</span>
                <textarea
                  required
                  rows={4}
                  placeholder="Enter the automatic response message…"
                  value={form.responseBody}
                  onChange={(e) => setForm({ ...form, responseBody: e.target.value })}
                />
              </label>

              <label className="ar-check">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
                />
                Rule is active
              </label>

              <div className="ar-modal-foot">
                <button type="button" className="wf-btn ghost" onClick={() => setModal('none')}>
                  Cancel
                </button>
                <button type="submit" className="wf-btn blue" disabled={busy}>
                  {busy ? 'Saving…' : modal === 'edit' ? 'Save Rule' : 'Create Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
