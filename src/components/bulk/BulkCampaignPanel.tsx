'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { blastApi, type BlastAccount, type BlastBatch, type CreateBlastPayload } from '@/lib/blast-api';
import { contactsApi, type ContactGroup, type ContactRow } from '@/lib/contacts-api';
import type { SavedTemplate } from '@/lib/template-types';

const TEMPLATES_KEY = 'whatsflow_templates_v1';
const MAX_ATTACH_MB = 10;
const ATTACH_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

type SelectionMethod = 'groups' | 'all_verified' | 'manual';
type MessageType = 'text' | 'template';
type ScheduleType = 'immediate' | 'later';

function loadTemplates(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(TEMPLATES_KEY);
    return raw ? (JSON.parse(raw) as SavedTemplate[]) : [];
  } catch {
    return [];
  }
}

export default function BulkCampaignPanel() {
  const router = useRouter();
  const [showCreate, setShowCreate] = useState(false);
  const [batches, setBatches] = useState<BlastBatch[]>([]);
  const [listLoading, setListLoading] = useState(true);
  const [toast, setToast] = useState('');
  const [error, setError] = useState('');

  // Form state
  const [campaignName, setCampaignName] = useState('');
  const [accounts, setAccounts] = useState<BlastAccount[]>([]);
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [messageType, setMessageType] = useState<MessageType>('text');
  const [messageBody, setMessageBody] = useState('');
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [selectionMethod, setSelectionMethod] = useState<SelectionMethod>('groups');
  const [groups, setGroups] = useState<ContactGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [contactSearch, setContactSearch] = useState('');
  const [contactsLoading, setContactsLoading] = useState(false);
  const [recipientCount, setRecipientCount] = useState(0);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [attachFile, setAttachFile] = useState<File | null>(null);
  const [attachError, setAttachError] = useState('');
  const [scheduleType, setScheduleType] = useState<ScheduleType>('immediate');
  const [scheduledAt, setScheduledAt] = useState('');
  const [delaySeconds, setDelaySeconds] = useState(5);
  const [maxRetries, setMaxRetries] = useState(3);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const loadBatches = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await blastApi.list();
      setBatches(res.batches || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load campaigns');
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBatches();
  }, [loadBatches]);

  const openCreate = async () => {
    setShowCreate(true);
    setError('');
    setFieldErrors({});
    setTemplates(loadTemplates());
    setAccountsLoading(true);
    setGroupsLoading(true);
    try {
      const [acc, gr] = await Promise.all([blastApi.listAccounts(), contactsApi.groups()]);
      setAccounts(acc.accounts || []);
      const ready = (acc.accounts || []).filter((a) => a.status === 'ready');
      if (ready.length === 1) setSelectedAccountIds([ready[0].id]);
      setGroups(gr.groups || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load form data');
    } finally {
      setAccountsLoading(false);
      setGroupsLoading(false);
    }
  };

  const resetForm = () => {
    setCampaignName('');
    setSelectedAccountIds([]);
    setMessageType('text');
    setMessageBody('');
    setTemplateId('');
    setSelectionMethod('groups');
    setSelectedGroupIds([]);
    setSelectedContactIds([]);
    setContactSearch('');
    setRecipientCount(0);
    setAttachFile(null);
    setAttachError('');
    setScheduleType('immediate');
    setScheduledAt('');
    setDelaySeconds(5);
    setMaxRetries(3);
    setFieldErrors({});
  };

  // Template body sync
  useEffect(() => {
    if (messageType !== 'template' || !templateId) return;
    const t = templates.find((x) => x.id === templateId);
    if (t) setMessageBody(t.body || '');
  }, [messageType, templateId, templates]);

  // Preview recipients (debounced)
  useEffect(() => {
    if (!showCreate) return;
    const t = setTimeout(() => {
      void (async () => {
        setPreviewLoading(true);
        try {
          const body: Parameters<typeof blastApi.previewRecipients>[0] = {
            selectionMethod:
              selectionMethod === 'groups'
                ? 'groups'
                : selectionMethod === 'all_verified'
                  ? 'all_verified'
                  : 'manual',
          };
          if (selectionMethod === 'groups') body.groupIds = selectedGroupIds;
          if (selectionMethod === 'manual') body.contactIds = selectedContactIds;
          if (selectionMethod === 'groups' && selectedGroupIds.length === 0) {
            setRecipientCount(0);
            setPreviewLoading(false);
            return;
          }
          if (selectionMethod === 'manual' && selectedContactIds.length === 0) {
            setRecipientCount(0);
            setPreviewLoading(false);
            return;
          }
          const res = await blastApi.previewRecipients(body);
          setRecipientCount(res.count);
        } catch {
          /* keep last count */
        } finally {
          setPreviewLoading(false);
        }
      })();
    }, 350);
    return () => clearTimeout(t);
  }, [showCreate, selectionMethod, selectedGroupIds, selectedContactIds]);

  // Manual contacts load
  useEffect(() => {
    if (!showCreate || selectionMethod !== 'manual') return;
    const t = setTimeout(() => {
      void (async () => {
        setContactsLoading(true);
        try {
          const res = await contactsApi.list({
            q: contactSearch || undefined,
            status: 'verified',
          });
          setContacts(res.contacts || []);
        } catch {
          setContacts([]);
        } finally {
          setContactsLoading(false);
        }
      })();
    }, 300);
    return () => clearTimeout(t);
  }, [showCreate, selectionMethod, contactSearch]);

  const readyAccounts = useMemo(
    () => accounts.filter((a) => a.status === 'ready'),
    [accounts],
  );

  const totalVerifiedAcrossGroups = useMemo(
    () => groups.reduce((s, g) => s + (g.stats?.verified || 0), 0),
    [groups],
  );

  function toggleAccount(id: string) {
    setSelectedAccountIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleGroup(id: string) {
    setSelectedGroupIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function toggleContact(id: string) {
    setSelectedContactIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  function onFile(f: File | null) {
    setAttachError('');
    setAttachFile(null);
    if (!f) return;
    if (!ATTACH_TYPES.includes(f.type)) {
      setAttachError('Supported formats: JPEG, PNG, GIF, WebP');
      return;
    }
    if (f.size > MAX_ATTACH_MB * 1024 * 1024) {
      setAttachError(`Max file size: ${MAX_ATTACH_MB}MB`);
      return;
    }
    setAttachFile(f);
  }

  function validate(): boolean {
    const err: Record<string, string> = {};
    if (!campaignName.trim()) err.campaignName = 'Campaign name is required';
    else if (campaignName.trim().length > 160) err.campaignName = 'Max 160 characters';
    if (selectedAccountIds.length === 0) err.accounts = 'Select at least one WhatsApp session';
    if (messageType === 'template' && !templateId) err.template = 'Select a template';
    if (!messageBody.trim()) err.message = 'Message content is required';
    else if (messageBody.length > 4096) err.message = 'Message too long (max 4096)';
    if (selectionMethod === 'groups' && selectedGroupIds.length === 0) {
      err.recipients = 'Select at least one contact group';
    }
    if (selectionMethod === 'manual' && selectedContactIds.length === 0) {
      err.recipients = 'Select at least one contact';
    }
    if (recipientCount <= 0 && selectionMethod === 'all_verified') {
      err.recipients = 'No verified contacts available';
    }
    if (scheduleType === 'later' && !scheduledAt) {
      err.schedule = 'Pick a date and time';
    }
    if (delaySeconds < 0 || delaySeconds > 300) err.delay = 'Delay must be 0–300 seconds';
    if (maxRetries < 0 || maxRetries > 10) err.retries = 'Retries must be 0–10';
    setFieldErrors(err);
    return Object.keys(err).length === 0;
  }

  async function submit() {
    if (submitting) return;
    setError('');
    if (!validate()) return;
    if (recipientCount <= 0) {
      setError('No eligible recipients. Verify contacts or select different groups.');
      return;
    }

    setSubmitting(true);
    try {
      // Primary account = first selected ready account
      const primary =
        readyAccounts.find((a) => selectedAccountIds.includes(a.id))?.id || selectedAccountIds[0];

      const payload: CreateBlastPayload = {
        whatsappAccountId: primary,
        whatsappAccountIds: selectedAccountIds,
        name: campaignName.trim(),
        messageBody: messageBody.trim(),
        kind: 'verify_and_send',
        selectionMethod:
          selectionMethod === 'groups'
            ? 'groups'
            : selectionMethod === 'all_verified'
              ? 'all_verified'
              : 'manual',
        groupIds: selectionMethod === 'groups' ? selectedGroupIds : undefined,
        contactIds: selectionMethod === 'manual' ? selectedContactIds : undefined,
        delaySeconds,
        maxRetries,
        scheduleType,
        scheduledAt: scheduleType === 'later' && scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        messageType,
        templateId: messageType === 'template' ? templateId : undefined,
        attachmentName: attachFile?.name,
      };

      const res = await blastApi.create(payload);
      showToast(`Campaign queued · ${res.totalNumbers} recipients`);
      setShowCreate(false);
      resetForm();
      router.push(`/dashboard/bulk/${res.batchId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Campaign creation failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="wf-bulk">
      <div className="wf-devices-head">
        <div>
          <h1>Bulk Messages</h1>
          <p>Create campaigns and send to verified contacts via your WhatsApp Business sessions.</p>
        </div>
        <button type="button" className="wf-add-device-btn" onClick={() => void openCreate()}>
          + Create Campaign
        </button>
      </div>

      {toast && <div className="wf-ct-toast">{toast}</div>}
      {error && !showCreate && <div className="wf-ct-error">{error}</div>}

      {/* Campaign list */}
      <div className="wf-bulk-list-card">
        <div className="wf-bulk-list-head">
          <h2>Recent campaigns</h2>
          <button type="button" className="wf-btn ghost" onClick={() => void loadBatches()}>
            Refresh
          </button>
        </div>
        {listLoading ? (
          <p className="wf-ct-muted">Loading campaigns…</p>
        ) : batches.length === 0 ? (
          <div className="wf-ct-empty">
            <strong>No campaigns yet</strong>
            <p>Create your first bulk campaign to start messaging.</p>
            <button type="button" className="wf-add-device-btn" onClick={() => void openCreate()}>
              Create Campaign
            </button>
          </div>
        ) : (
          <div className="wf-bulk-table-wrap">
            <table className="wf-ct-table">
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th>Recipients</th>
                  <th>Sent</th>
                  <th>Failed</th>
                  <th>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => {
                  const name =
                    (b.payload && typeof b.payload === 'object' && (b.payload as { name?: string }).name) ||
                    b.messageBody?.slice(0, 40) ||
                    b.id.slice(0, 8);
                  return (
                    <tr key={b.id}>
                      <td>
                        <strong>{String(name)}</strong>
                        <div className="wf-ct-muted" style={{ fontSize: 11 }}>
                          {b.whatsappAccount?.label || '—'}
                        </div>
                      </td>
                      <td>
                        <span className={`wf-bulk-status ${b.status}`}>{b.status}</span>
                      </td>
                      <td>{b.totalNumbers}</td>
                      <td>{b.sentCount}</td>
                      <td>{b.failedCount}</td>
                      <td>{new Date(b.createdAt).toLocaleString()}</td>
                      <td>
                        <Link href={`/dashboard/bulk/${b.id}`} className="wf-link-btn">
                          View
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div className="wf-modal-backdrop" role="dialog" aria-modal>
          <div className="wf-modal wf-bulk-modal">
            <div className="wf-modal-head">
              <h3>Create Bulk Campaign</h3>
              <button
                type="button"
                className="wf-modal-x"
                aria-label="Close"
                onClick={() => {
                  if (submitting) return;
                  if (campaignName || messageBody) {
                    if (!window.confirm('Discard this campaign draft?')) return;
                  }
                  setShowCreate(false);
                  resetForm();
                  setError('');
                }}
              >
                ×
              </button>
            </div>

            {error && <div className="wf-ct-error">{error}</div>}

            <div className="wf-bulk-grid">
              {/* LEFT — Campaign Settings */}
              <section className="wf-bulk-col">
                <h4 className="wf-bulk-section-title">Campaign Settings</h4>

                <label className="wf-tpl-label">Campaign Name *</label>
                <input
                  className={`wf-modal-input ${fieldErrors.campaignName ? 'is-error' : ''}`}
                  placeholder="e.g., Product Launch Announcement"
                  value={campaignName}
                  maxLength={160}
                  onChange={(e) => setCampaignName(e.target.value)}
                />
                {fieldErrors.campaignName && (
                  <p className="wf-field-error">{fieldErrors.campaignName}</p>
                )}

                <label className="wf-tpl-label">WhatsApp Sessions *</label>
                <p className="wf-tpl-hint">Select one or more ready sessions (primary = first selected).</p>
                {accountsLoading ? (
                  <p className="wf-ct-muted">Loading WhatsApp sessions…</p>
                ) : readyAccounts.length === 0 ? (
                  <div className="wf-bulk-warn">
                    No ready WhatsApp sessions. Connect a Business account on{' '}
                    <Link href="/dashboard/devices">Devices</Link>, then register it for blasting if needed.
                    <div style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="wf-btn ghost"
                        onClick={async () => {
                          try {
                            const label = window.prompt('Session label', 'Business') || 'Business';
                            await blastApi.createAccount(label);
                            const acc = await blastApi.listAccounts();
                            setAccounts(acc.accounts || []);
                            showToast('Account registered — connect it via worker/Devices before sending');
                          } catch (e) {
                            setError(e instanceof Error ? e.message : 'Failed');
                          }
                        }}
                      >
                        + Register session for campaigns
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="wf-bulk-checks">
                    {accounts.map((a) => {
                      const usable = a.status === 'ready';
                      return (
                        <label
                          key={a.id}
                          className={`wf-bulk-check ${!usable ? 'disabled' : ''} ${selectedAccountIds.includes(a.id) ? 'on' : ''}`}
                        >
                          <input
                            type="checkbox"
                            disabled={!usable}
                            checked={selectedAccountIds.includes(a.id)}
                            onChange={() => toggleAccount(a.id)}
                          />
                          <span>
                            <strong>{a.label}</strong>
                            <em>
                              {a.phone ? `+${a.phone}` : 'No phone'} · {a.status}
                            </em>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                )}
                {fieldErrors.accounts && <p className="wf-field-error">{fieldErrors.accounts}</p>}

                <label className="wf-tpl-label">Message Type</label>
                <div className="wf-bulk-msg-types">
                  <button
                    type="button"
                    className={`wf-bulk-type-card ${messageType === 'text' ? 'active' : ''}`}
                    onClick={() => setMessageType('text')}
                  >
                    <span className="ico">💬</span>
                    <strong>Text Message</strong>
                    <em>Text with optional attachment</em>
                  </button>
                  <button
                    type="button"
                    className={`wf-bulk-type-card ${messageType === 'template' ? 'active' : ''}`}
                    onClick={() => setMessageType('template')}
                  >
                    <span className="ico">📄</span>
                    <strong>Template Message</strong>
                    <em>Use saved template</em>
                  </button>
                </div>

                {messageType === 'template' && (
                  <>
                    <label className="wf-tpl-label">Select Template</label>
                    <select
                      className="wf-modal-input"
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                    >
                      <option value="">Choose a template…</option>
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name} ({t.category})
                        </option>
                      ))}
                    </select>
                    {templates.length === 0 && (
                      <p className="wf-tpl-hint">
                        No templates yet. Create one under <Link href="/dashboard/templates">Templates</Link>.
                      </p>
                    )}
                    {fieldErrors.template && <p className="wf-field-error">{fieldErrors.template}</p>}
                  </>
                )}

                <label className="wf-tpl-label">Message Content *</label>
                <textarea
                  className={`wf-tpl-textarea ${fieldErrors.message ? 'is-error' : ''}`}
                  rows={6}
                  placeholder={'Enter your message here…\n\nHi {{name}}, offer for {{company}}'}
                  value={messageBody}
                  maxLength={4096}
                  onChange={(e) => setMessageBody(e.target.value)}
                />
                <div className="wf-bulk-char">
                  <span className="wf-tpl-hint">Variables like {'{{name}}'} work if contacts have those fields.</span>
                  <span>{messageBody.length}/4096</span>
                </div>
                {fieldErrors.message && <p className="wf-field-error">{fieldErrors.message}</p>}

                <label className="wf-tpl-label">Attachment (Optional)</label>
                <select className="wf-modal-input" defaultValue="image" disabled>
                  <option value="image">Image</option>
                </select>
                <div className="wf-bulk-file">
                  <input
                    type="file"
                    accept={ATTACH_TYPES.join(',')}
                    onChange={(e) => onFile(e.target.files?.[0] || null)}
                  />
                  {attachFile && (
                    <button type="button" className="wf-link-btn" onClick={() => onFile(null)}>
                      Remove {attachFile.name}
                    </button>
                  )}
                </div>
                <p className="wf-tpl-hint">
                  Max {MAX_ATTACH_MB}MB · JPEG, PNG, GIF, WebP. Filename is stored with the campaign; media upload
                  to the worker path can be wired when media blast is enabled.
                </p>
                {attachError && <p className="wf-field-error">{attachError}</p>}

                <div className="wf-tpl-row2">
                  <div>
                    <label className="wf-tpl-label">Schedule Type</label>
                    <select
                      className="wf-modal-input"
                      value={scheduleType}
                      onChange={(e) => setScheduleType(e.target.value as ScheduleType)}
                    >
                      <option value="immediate">Send Immediately</option>
                      <option value="later">Schedule for Later</option>
                    </select>
                    {scheduleType === 'later' && (
                      <input
                        type="datetime-local"
                        className="wf-modal-input"
                        value={scheduledAt}
                        onChange={(e) => setScheduledAt(e.target.value)}
                      />
                    )}
                    {fieldErrors.schedule && <p className="wf-field-error">{fieldErrors.schedule}</p>}
                    <p className="wf-tpl-hint">
                      Scheduled time is stored as metadata. Execution pacing is enforced by the worker.
                    </p>
                  </div>
                  <div>
                    <label className="wf-tpl-label">Delay Between (seconds)</label>
                    <input
                      type="number"
                      className="wf-modal-input"
                      min={0}
                      max={300}
                      value={delaySeconds}
                      onChange={(e) => setDelaySeconds(Number(e.target.value))}
                    />
                    <p className="wf-tpl-hint">UI preference only — worker anti-ban sleep (20–45s) remains authoritative.</p>
                    {fieldErrors.delay && <p className="wf-field-error">{fieldErrors.delay}</p>}
                  </div>
                </div>

                <label className="wf-tpl-label">Max Retries for Failed Messages</label>
                <input
                  type="number"
                  className="wf-modal-input"
                  min={0}
                  max={10}
                  value={maxRetries}
                  onChange={(e) => setMaxRetries(Number(e.target.value))}
                />
                <p className="wf-tpl-hint">Stored with the batch; BullMQ job attempts remain backend-controlled.</p>
                {fieldErrors.retries && <p className="wf-field-error">{fieldErrors.retries}</p>}
              </section>

              {/* RIGHT — Contact Selection */}
              <section className="wf-bulk-col">
                <h4 className="wf-bulk-section-title">Contact Selection</h4>
                <label className="wf-tpl-label">Selection Method</label>
                <div className="wf-bulk-radio-stack">
                  {(
                    [
                      ['groups', 'Contact Groups', 'Recommended'],
                      ['all_verified', 'All Verified Contacts', ''],
                      ['manual', 'Manual Selection', ''],
                    ] as const
                  ).map(([val, label, tag]) => (
                    <label key={val} className={`wf-bulk-radio ${selectionMethod === val ? 'on' : ''}`}>
                      <input
                        type="radio"
                        name="sel"
                        checked={selectionMethod === val}
                        onChange={() => setSelectionMethod(val)}
                      />
                      <span>
                        <strong>
                          {label} {tag && <em className="tag">{tag}</em>}
                        </strong>
                      </span>
                    </label>
                  ))}
                </div>

                {selectionMethod === 'groups' && (
                  <>
                    <label className="wf-tpl-label">Select Contact Groups</label>
                    {groupsLoading ? (
                      <p className="wf-ct-muted">Loading contact groups…</p>
                    ) : groups.length === 0 ? (
                      <p className="wf-tpl-hint">
                        No groups. Create one under <Link href="/dashboard/contacts">Contacts</Link>.
                      </p>
                    ) : (
                      <div className="wf-bulk-checks">
                        {groups.map((g) => (
                          <label
                            key={g.id}
                            className={`wf-bulk-check ${selectedGroupIds.includes(g.id) ? 'on' : ''}`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedGroupIds.includes(g.id)}
                              onChange={() => toggleGroup(g.id)}
                            />
                            <span>
                              <strong>{g.name}</strong>
                              <em>
                                {g.stats.verified} verified / {g.stats.total} total
                              </em>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </>
                )}

                {selectionMethod === 'all_verified' && (
                  <div className="wf-bulk-summary-box">
                    <strong>{totalVerifiedAcrossGroups || '—'}</strong>
                    <span>verified contacts across groups (server resolves exact set)</span>
                  </div>
                )}

                {selectionMethod === 'manual' && (
                  <>
                    <label className="wf-tpl-label">Search contacts</label>
                    <input
                      className="wf-modal-input"
                      placeholder="Search contacts…"
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                    />
                    {contactsLoading ? (
                      <p className="wf-ct-muted">Loading contacts…</p>
                    ) : (
                      <div className="wf-bulk-contact-list">
                        {contacts.length === 0 ? (
                          <p className="wf-tpl-hint">No verified contacts found.</p>
                        ) : (
                          contacts.slice(0, 50).map((c) => (
                            <label key={c.id} className="wf-bulk-check">
                              <input
                                type="checkbox"
                                checked={selectedContactIds.includes(c.id)}
                                onChange={() => toggleContact(c.id)}
                              />
                              <span>
                                <strong>{c.name || '—'}</strong>
                                <em>
                                  +{c.phone} · {c.waStatus}
                                </em>
                              </span>
                            </label>
                          ))
                        )}
                      </div>
                    )}
                    <p className="wf-tpl-hint">{selectedContactIds.length} selected</p>
                  </>
                )}

                {fieldErrors.recipients && <p className="wf-field-error">{fieldErrors.recipients}</p>}

                <div className="wf-bulk-recipient-summary">
                  <div className="num">{previewLoading ? '…' : recipientCount.toLocaleString()}</div>
                  <div className="lbl">
                    eligible contacts will receive this message
                    <br />
                    <small>Final count is resolved on the server when you create the campaign.</small>
                  </div>
                </div>

                <div className="wf-bulk-review">
                  <h5>Campaign Summary</h5>
                  <ul>
                    <li>
                      <span>Campaign</span>
                      <strong>{campaignName.trim() || '—'}</strong>
                    </li>
                    <li>
                      <span>WhatsApp sessions</span>
                      <strong>{selectedAccountIds.length} selected</strong>
                    </li>
                    <li>
                      <span>Recipients</span>
                      <strong>{recipientCount.toLocaleString()}</strong>
                    </li>
                    <li>
                      <span>Message</span>
                      <strong>{messageType === 'text' ? 'Text Message' : 'Template'}</strong>
                    </li>
                    <li>
                      <span>Attachment</span>
                      <strong>{attachFile ? attachFile.name : 'None'}</strong>
                    </li>
                    <li>
                      <span>Schedule</span>
                      <strong>
                        {scheduleType === 'immediate' ? 'Send Immediately' : scheduledAt || 'Later'}
                      </strong>
                    </li>
                    <li>
                      <span>Retries</span>
                      <strong>{maxRetries}</strong>
                    </li>
                  </ul>
                </div>
              </section>
            </div>

            <div className="wf-bulk-footer">
              <button
                type="button"
                className="wf-btn ghost"
                disabled={submitting}
                onClick={() => {
                  if (campaignName || messageBody) {
                    if (!window.confirm('Discard this campaign draft?')) return;
                  }
                  setShowCreate(false);
                  resetForm();
                  setError('');
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="wf-btn green"
                disabled={submitting}
                onClick={() => void submit()}
              >
                {submitting ? 'Creating campaign…' : 'Create & Send →'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
