'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  TEMPLATE_TYPES,
  CATEGORIES,
  emptyTemplate,
  type TemplateTypeId,
  type TemplateTypeDef,
  type SavedTemplate,
  type ButtonRow,
  type ContactCard,
  type ListSection,
} from '@/lib/template-types';

const STORAGE_KEY = 'whatsflow_templates_v1';

function loadTemplates(): SavedTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SavedTemplate[]) : [];
  } catch {
    return [];
  }
}

function saveTemplates(list: SavedTemplate[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function TypeIcon({ name }: { name: string }) {
  const p = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 } as const;
  switch (name) {
    case 'text':
      return <svg {...p}><path d="M4 6h16v10H8l-4 3V6z" strokeLinejoin="round" /></svg>;
    case 'image':
      return <svg {...p}><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="11" r="1.5" /><path d="M4 16l5-4 3 3 4-5 4 4" strokeLinejoin="round" /></svg>;
    case 'doc':
      return <svg {...p}><path d="M7 3h7l5 5v13H7V3z" strokeLinejoin="round" /><path d="M14 3v5h5" /></svg>;
    case 'contact':
      return <svg {...p}><circle cx="9" cy="8" r="3" /><path d="M4 19c0-3 2-5 5-5s5 2 5 5" strokeLinecap="round" /><path d="M16 8h4M18 6v4" strokeLinecap="round" /></svg>;
    case 'poll':
      return <svg {...p}><path d="M5 19V10M10 19V5M15 19v-6M20 19V8" strokeLinecap="round" /></svg>;
    case 'buttons':
      return <svg {...p}><rect x="4" y="4" width="16" height="6" rx="1.5" /><rect x="4" y="14" width="7" height="5" rx="1.5" /><rect x="13" y="14" width="7" height="5" rx="1.5" /></svg>;
    case 'list':
      return <svg {...p}><path d="M8 7h12M8 12h12M8 17h12" strokeLinecap="round" /><circle cx="4.5" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="17" r="1" fill="currentColor" stroke="none" /></svg>;
    case 'location':
      return <svg {...p}><path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10z" /><circle cx="12" cy="11" r="2" /></svg>;
    case 'video':
      return <svg {...p}><rect x="3" y="6" width="14" height="12" rx="2" /><path d="M17 10l4-2v8l-4-2v-4z" strokeLinejoin="round" /></svg>;
    case 'audio':
      return <svg {...p}><path d="M11 5v14M7 9v6M15 7v10M3 11v2M19 8v8" strokeLinecap="round" /></svg>;
    case 'cta':
      return <svg {...p}><path d="M7 12h10M13 8l4 4-4 4" strokeLinecap="round" strokeLinejoin="round" /><rect x="3" y="4" width="18" height="16" rx="2" /></svg>;
    case 'copy':
      return <svg {...p}><rect x="8" y="8" width="12" height="12" rx="2" /><path d="M4 16V6a2 2 0 0 1 2-2h10" strokeLinecap="round" /></svg>;
    case 'mixed':
      return <svg {...p}><rect x="3" y="4" width="18" height="5" rx="1.5" /><rect x="3" y="11" width="8" height="4" rx="1.5" /><rect x="13" y="11" width="8" height="4" rx="1.5" /><rect x="3" y="17" width="18" height="3" rx="1" /></svg>;
    default:
      return null;
  }
}

export default function TemplatesPanel() {
  const [templates, setTemplates] = useState<SavedTemplate[]>([]);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(() => emptyTemplate('text'));
  const [error, setError] = useState('');

  useEffect(() => {
    setTemplates(loadTemplates());
  }, []);

  const typeDef = useMemo(
    () => TEMPLATE_TYPES.find((t) => t.id === form.type) || TEMPLATE_TYPES[0],
    [form.type],
  );

  function openCreate() {
    setEditingId(null);
    setForm(emptyTemplate('text'));
    setError('');
    setOpen(true);
  }

  function openEdit(t: SavedTemplate) {
    setEditingId(t.id);
    const { id: _id, createdAt: _c, ...rest } = t;
    setForm({ ...emptyTemplate(t.type), ...rest });
    setError('');
    setOpen(true);
  }

  function selectType(t: TemplateTypeDef) {
    setForm((f) => ({ ...f, type: t.id }));
  }

  function patch<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function save() {
    if (!form.name.trim()) {
      setError('Template name is required.');
      return;
    }
    if (!form.body.trim()) {
      setError('Message content (body) is required for all templates.');
      return;
    }
    if (form.footer.length > 60) {
      setError('Footer max 60 characters.');
      return;
    }

    const list = loadTemplates();
    if (editingId) {
      const next = list.map((t) =>
        t.id === editingId
          ? { ...t, ...form, id: editingId, createdAt: t.createdAt }
          : t,
      );
      saveTemplates(next);
      setTemplates(next);
    } else {
      const item: SavedTemplate = {
        ...form,
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
      };
      const next = [item, ...list];
      saveTemplates(next);
      setTemplates(next);
    }
    setOpen(false);
  }

  function remove(id: string) {
    if (!window.confirm('Delete this template?')) return;
    const next = loadTemplates().filter((t) => t.id !== id);
    saveTemplates(next);
    setTemplates(next);
  }

  return (
    <div className="wf-tpl">
      <div className="wf-devices-head">
        <div>
          <h1>Templates</h1>
          <p>Build reusable WhatsApp message templates with variables like {'{{name}}'}.</p>
        </div>
        <button type="button" className="wf-add-device-btn" onClick={openCreate}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Create Template
        </button>
      </div>

      {templates.length === 0 ? (
        <div className="wf-dev-empty">
          <div className="wf-dev-empty-icon">
            <TypeIcon name="text" />
          </div>
          <h2>No templates yet</h2>
          <p>Create your first template — text, media, buttons, lists, and more.</p>
          <button type="button" className="wf-add-device-btn" onClick={openCreate}>
            Create Template
          </button>
        </div>
      ) : (
        <div className="wf-tpl-list">
          {templates.map((t) => {
            const def = TEMPLATE_TYPES.find((x) => x.id === t.type);
            return (
              <article key={t.id} className="wf-tpl-card">
                <div className="wf-tpl-card-icon">
                  <TypeIcon name={def?.icon || 'text'} />
                </div>
                <div className="wf-tpl-card-body">
                  <strong>{t.name}</strong>
                  <span>
                    {def?.label || t.type} · {t.category}
                  </span>
                  <p>{t.body.slice(0, 100)}{t.body.length > 100 ? '…' : ''}</p>
                </div>
                <div className="wf-tpl-card-actions">
                  <button type="button" className="wf-btn ghost" onClick={() => openEdit(t)}>
                    Edit
                  </button>
                  <button type="button" className="wf-btn red" onClick={() => remove(t.id)}>
                    Delete
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      {open && (
        <div className="wf-modal-backdrop" role="dialog" aria-modal>
          <div className="wf-modal wf-tpl-modal">
            <div className="wf-modal-head">
              <div className="wf-tpl-modal-title">
                <span className="wf-tpl-plus">+</span>
                <h3>{editingId ? 'Edit Template' : 'Create New Template'}</h3>
              </div>
              <button type="button" className="wf-modal-x" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>

            <label className="wf-tpl-label">Template Type</label>
            <div className="wf-tpl-types">
              {TEMPLATE_TYPES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`wf-tpl-type ${form.type === t.id ? 'active' : ''}`}
                  onClick={() => selectType(t)}
                >
                  <TypeIcon name={t.icon} />
                  <span>{t.label}</span>
                </button>
              ))}
            </div>
            <p className="wf-tpl-hint">{typeDef.hint}</p>

            <div className="wf-tpl-row2">
              <div>
                <label className="wf-tpl-label">Template Name</label>
                <input
                  className="wf-modal-input"
                  placeholder="e.g., Welcome Message"
                  value={form.name}
                  onChange={(e) => patch('name', e.target.value)}
                />
              </div>
              <div>
                <label className="wf-tpl-label">Category</label>
                <select
                  className="wf-modal-input"
                  value={form.category}
                  onChange={(e) => patch('category', e.target.value)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Header media */}
            {(typeDef.header === 'image' ||
              typeDef.header === 'document' ||
              typeDef.header === 'video' ||
              typeDef.header === 'audio') && (
              <MediaSection
                kind={typeDef.header}
                form={form}
                onPatch={patch}
              />
            )}

            {typeDef.header === 'location' && (
              <LocationSection form={form} onPatch={patch} />
            )}

            {/* Body — always required */}
            <label className="wf-tpl-label">Message Content</label>
            <textarea
              className="wf-tpl-textarea"
              rows={4}
              placeholder="Enter your message content here… Use {{variable}} for dynamic content"
              value={form.body}
              onChange={(e) => patch('body', e.target.value)}
            />
            <p className="wf-tpl-hint">Use {'{{name}}'}, {'{{phone}}'}, etc. Body text is required for all templates.</p>

            {/* Footer — text-like types */}
            {(typeDef.header === 'none' ||
              typeDef.header === 'image' ||
              typeDef.header === 'document' ||
              typeDef.header === 'video' ||
              typeDef.header === 'location' ||
              typeDef.buttons === 'quick_reply' ||
              typeDef.buttons === 'mixed' ||
              typeDef.buttons === 'cta' ||
              typeDef.buttons === 'copy_code' ||
              typeDef.buttons === 'list_menu') && (
              <>
                <label className="wf-tpl-label">Footer (optional, max 60)</label>
                <input
                  className="wf-modal-input"
                  maxLength={60}
                  placeholder="Small gray line under the message"
                  value={form.footer}
                  onChange={(e) => patch('footer', e.target.value)}
                />
              </>
            )}

            {typeDef.buttons === 'contact' && (
              <ContactSection
                contacts={form.contacts || []}
                onChange={(contacts) => patch('contacts', contacts)}
              />
            )}

            {typeDef.buttons === 'poll' && (
              <PollSection form={form} onPatch={patch} />
            )}

            {(typeDef.buttons === 'quick_reply' || typeDef.buttons === 'mixed') && (
              <ButtonBuilder
                buttons={form.buttons || []}
                max={3}
                allowMix={typeDef.buttons === 'mixed'}
                onChange={(buttons) => patch('buttons', buttons)}
              />
            )}

            {typeDef.buttons === 'cta' && (
              <CtaSection
                buttons={form.buttons || []}
                onChange={(buttons) => patch('buttons', buttons)}
              />
            )}

            {typeDef.buttons === 'copy_code' && (
              <CopyCodeSection form={form} onPatch={patch} />
            )}

            {typeDef.buttons === 'list_menu' && (
              <ListBuilder
                buttonText={form.listButtonText || 'View Options'}
                sections={form.listSections || []}
                onButtonText={(v) => patch('listButtonText', v)}
                onSections={(s) => patch('listSections', s)}
              />
            )}

            {error && <p className="wf-modal-error">{error}</p>}

            <div className="wf-modal-actions">
              <button type="button" className="wf-btn ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" className="wf-btn green" onClick={save}>
                {editingId ? 'Save changes' : 'Create template'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function MediaSection({
  kind,
  form,
  onPatch,
}: {
  kind: string;
  form: ReturnType<typeof emptyTemplate>;
  onPatch: <K extends keyof ReturnType<typeof emptyTemplate>>(k: K, v: ReturnType<typeof emptyTemplate>[K]) => void;
}) {
  const limits: Record<string, string> = {
    image: 'JPEG/PNG · max 5MB',
    document: 'PDF/DOCX/XLSX · max 100MB',
    video: 'MP4 · max 16MB',
    audio: 'MP3/OGG/AAC · max 16MB',
  };
  return (
    <div className="wf-tpl-block">
      <label className="wf-tpl-label">
        {kind.charAt(0).toUpperCase() + kind.slice(1)} header
      </label>
      <div className="wf-tpl-toggle-row">
        <button
          type="button"
          className={form.mediaUrlMode === 'upload' ? 'active' : ''}
          onClick={() => onPatch('mediaUrlMode', 'upload')}
        >
          Upload
        </button>
        <button
          type="button"
          className={form.mediaUrlMode === 'variable' ? 'active' : ''}
          onClick={() => onPatch('mediaUrlMode', 'variable')}
        >
          Use variable URL
        </button>
      </div>
      {form.mediaUrlMode === 'upload' ? (
        <input
          type="file"
          className="wf-modal-input"
          accept={
            kind === 'image'
              ? 'image/jpeg,image/png'
              : kind === 'video'
                ? 'video/mp4'
                : kind === 'audio'
                  ? 'audio/*'
                  : '.pdf,.doc,.docx,.xls,.xlsx'
          }
          onChange={(e) => onPatch('mediaName', e.target.files?.[0]?.name || '')}
        />
      ) : (
        <input
          className="wf-modal-input"
          placeholder="{{image_url}}"
          value={form.mediaVariable || ''}
          onChange={(e) => onPatch('mediaVariable', e.target.value)}
        />
      )}
      <p className="wf-tpl-hint">{limits[kind]}{form.mediaName ? ` · Selected: ${form.mediaName}` : ''}</p>
      {kind === 'document' && (
        <>
          <label className="wf-tpl-label">Document filename (shown to recipient)</label>
          <input
            className="wf-modal-input"
            placeholder="Price-list.pdf"
            value={form.docFilename || ''}
            onChange={(e) => onPatch('docFilename', e.target.value)}
          />
        </>
      )}
    </div>
  );
}

function LocationSection({
  form,
  onPatch,
}: {
  form: ReturnType<typeof emptyTemplate>;
  onPatch: <K extends keyof ReturnType<typeof emptyTemplate>>(k: K, v: ReturnType<typeof emptyTemplate>[K]) => void;
}) {
  return (
    <div className="wf-tpl-block">
      <label className="wf-tpl-label">Location</label>
      <div className="wf-tpl-row2">
        <input className="wf-modal-input" placeholder="Latitude" value={form.lat || ''} onChange={(e) => onPatch('lat', e.target.value)} />
        <input className="wf-modal-input" placeholder="Longitude" value={form.lng || ''} onChange={(e) => onPatch('lng', e.target.value)} />
      </div>
      <input className="wf-modal-input" placeholder="Location name" value={form.locationName || ''} onChange={(e) => onPatch('locationName', e.target.value)} />
      <input className="wf-modal-input" placeholder="Address label" value={form.locationAddress || ''} onChange={(e) => onPatch('locationAddress', e.target.value)} />
    </div>
  );
}

function ContactSection({
  contacts,
  onChange,
}: {
  contacts: ContactCard[];
  onChange: (c: ContactCard[]) => void;
}) {
  return (
    <div className="wf-tpl-block">
      <label className="wf-tpl-label">Contacts</label>
      {contacts.map((c, i) => (
        <div key={c.id} className="wf-tpl-nested">
          <div className="wf-tpl-nested-head">
            <span>Contact {i + 1}</span>
            {contacts.length > 1 && (
              <button type="button" className="wf-link-btn" onClick={() => onChange(contacts.filter((x) => x.id !== c.id))}>
                Remove
              </button>
            )}
          </div>
          <input className="wf-modal-input" placeholder="Name" value={c.name} onChange={(e) => onChange(contacts.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)))} />
          <input className="wf-modal-input" placeholder="Phone" value={c.phone} onChange={(e) => onChange(contacts.map((x) => (x.id === c.id ? { ...x, phone: e.target.value } : x)))} />
          <input className="wf-modal-input" placeholder="Email" value={c.email} onChange={(e) => onChange(contacts.map((x) => (x.id === c.id ? { ...x, email: e.target.value } : x)))} />
          <input className="wf-modal-input" placeholder="Organization" value={c.org} onChange={(e) => onChange(contacts.map((x) => (x.id === c.id ? { ...x, org: e.target.value } : x)))} />
        </div>
      ))}
      <button
        type="button"
        className="wf-btn ghost"
        onClick={() =>
          onChange([...contacts, { id: crypto.randomUUID(), name: '', phone: '', email: '', org: '' }])
        }
      >
        + Add another contact
      </button>
    </div>
  );
}

function PollSection({
  form,
  onPatch,
}: {
  form: ReturnType<typeof emptyTemplate>;
  onPatch: <K extends keyof ReturnType<typeof emptyTemplate>>(k: K, v: ReturnType<typeof emptyTemplate>[K]) => void;
}) {
  const opts = form.pollOptions || [];
  return (
    <div className="wf-tpl-block">
      <p className="wf-tpl-note">Note: Polls are custom interactive messages (not Meta-approved template types).</p>
      <label className="wf-tpl-label">Poll question</label>
      <input className="wf-modal-input" value={form.pollQuestion || ''} onChange={(e) => onPatch('pollQuestion', e.target.value)} />
      <label className="wf-tpl-label">Options (2–10)</label>
      {opts.map((o, i) => (
        <div key={i} className="wf-tpl-inline">
          <input
            className="wf-modal-input"
            value={o}
            onChange={(e) => {
              const next = [...opts];
              next[i] = e.target.value;
              onPatch('pollOptions', next);
            }}
          />
          {opts.length > 2 && (
            <button type="button" className="wf-btn ghost" onClick={() => onPatch('pollOptions', opts.filter((_, j) => j !== i))}>
              ✕
            </button>
          )}
        </div>
      ))}
      {opts.length < 10 && (
        <button type="button" className="wf-btn ghost" onClick={() => onPatch('pollOptions', [...opts, `Option ${opts.length + 1}`])}>
          + Add option
        </button>
      )}
      <label className="wf-wa-stay" style={{ marginTop: 8 }}>
        <input type="checkbox" checked={!!form.pollMulti} onChange={(e) => onPatch('pollMulti', e.target.checked)} />
        <span className="wf-wa-check" />
        Allow multi-select
      </label>
    </div>
  );
}

function ButtonBuilder({
  buttons,
  max,
  allowMix,
  onChange,
}: {
  buttons: ButtonRow[];
  max: number;
  allowMix: boolean;
  onChange: (b: ButtonRow[]) => void;
}) {
  return (
    <div className="wf-tpl-block">
      <label className="wf-tpl-label">Buttons (max {max})</label>
      {buttons.map((b, i) => (
        <div key={b.id} className="wf-tpl-nested">
          <div className="wf-tpl-nested-head">
            <span>Button {i + 1}</span>
            {buttons.length > 1 && (
              <button type="button" className="wf-link-btn" onClick={() => onChange(buttons.filter((x) => x.id !== b.id))}>
                Remove
              </button>
            )}
          </div>
          <div className="wf-tpl-row2">
            <input
              className="wf-modal-input"
              maxLength={20}
              placeholder="Label (max 20)"
              value={b.label}
              onChange={(e) =>
                onChange(buttons.map((x) => (x.id === b.id ? { ...x, label: e.target.value } : x)))
              }
            />
            <select
              className="wf-modal-input"
              value={b.type}
              onChange={(e) =>
                onChange(
                  buttons.map((x) =>
                    x.id === b.id
                      ? { ...x, type: e.target.value as ButtonRow['type'] }
                      : x,
                  ),
                )
              }
            >
              <option value="quick_reply">Quick Reply</option>
              <option value="url">Visit Website</option>
              <option value="call">Call Phone</option>
            </select>
          </div>
          {b.type === 'url' && (
            <input
              className="wf-modal-input"
              placeholder="https://… or {{1}}"
              value={b.url || ''}
              onChange={(e) =>
                onChange(buttons.map((x) => (x.id === b.id ? { ...x, url: e.target.value } : x)))
              }
            />
          )}
          {b.type === 'call' && (
            <input
              className="wf-modal-input"
              placeholder="+91…"
              value={b.phone || ''}
              onChange={(e) =>
                onChange(buttons.map((x) => (x.id === b.id ? { ...x, phone: e.target.value } : x)))
              }
            />
          )}
        </div>
      ))}
      {buttons.length < max && (
        <button
          type="button"
          className="wf-btn ghost"
          onClick={() =>
            onChange([...buttons, { id: crypto.randomUUID(), label: '', type: 'quick_reply' }])
          }
        >
          + Add button
        </button>
      )}
    </div>
  );
}

function CtaSection({
  buttons,
  onChange,
}: {
  buttons: ButtonRow[];
  onChange: (b: ButtonRow[]) => void;
}) {
  const b = buttons[0] || { id: crypto.randomUUID(), label: '', type: 'url' as const, url: '' };
  const single = buttons[0] ? buttons : [b];
  return (
    <div className="wf-tpl-block">
      <label className="wf-tpl-label">CTA button (1 only)</label>
      <input
        className="wf-modal-input"
        maxLength={20}
        placeholder="Button label"
        value={single[0].label}
        onChange={(e) => onChange([{ ...single[0], label: e.target.value }])}
      />
      <select
        className="wf-modal-input"
        value={single[0].type === 'call' ? 'call' : 'url'}
        onChange={(e) =>
          onChange([{ ...single[0], type: e.target.value as 'url' | 'call' }])
        }
      >
        <option value="url">Visit Website</option>
        <option value="call">Call Phone Number</option>
      </select>
      {single[0].type === 'call' ? (
        <input
          className="wf-modal-input"
          placeholder="+91…"
          value={single[0].phone || ''}
          onChange={(e) => onChange([{ ...single[0], phone: e.target.value }])}
        />
      ) : (
        <input
          className="wf-modal-input"
          placeholder="https://…"
          value={single[0].url || ''}
          onChange={(e) => onChange([{ ...single[0], type: 'url', url: e.target.value }])}
        />
      )}
    </div>
  );
}

function CopyCodeSection({
  form,
  onPatch,
}: {
  form: ReturnType<typeof emptyTemplate>;
  onPatch: <K extends keyof ReturnType<typeof emptyTemplate>>(k: K, v: ReturnType<typeof emptyTemplate>[K]) => void;
}) {
  return (
    <div className="wf-tpl-block">
      <label className="wf-tpl-label">Copy-code button</label>
      <input
        className="wf-modal-input"
        placeholder="Button label"
        value={form.copyLabel || 'Copy Code'}
        onChange={(e) => onPatch('copyLabel', e.target.value)}
      />
      <label className="wf-tpl-label">Example code (for review)</label>
      <input
        className="wf-modal-input"
        placeholder="SAVE20"
        value={form.copyExample || ''}
        onChange={(e) => onPatch('copyExample', e.target.value)}
      />
      <p className="wf-tpl-hint">Actual codes are usually injected per-send via {'{{1}}'}.</p>
    </div>
  );
}

function ListBuilder({
  buttonText,
  sections,
  onButtonText,
  onSections,
}: {
  buttonText: string;
  sections: ListSection[];
  onButtonText: (v: string) => void;
  onSections: (s: ListSection[]) => void;
}) {
  const totalRows = sections.reduce((n, s) => n + s.rows.length, 0);
  return (
    <div className="wf-tpl-block">
      <label className="wf-tpl-label">List button text</label>
      <input className="wf-modal-input" value={buttonText} onChange={(e) => onButtonText(e.target.value)} />
      <p className="wf-tpl-hint">Max 10 rows total across sections ({totalRows}/10).</p>
      {sections.map((sec, si) => (
        <div key={sec.id} className="wf-tpl-nested">
          <div className="wf-tpl-nested-head">
            <input
              className="wf-modal-input"
              style={{ marginBottom: 0 }}
              placeholder="Section title"
              value={sec.title}
              onChange={(e) =>
                onSections(sections.map((s) => (s.id === sec.id ? { ...s, title: e.target.value } : s)))
              }
            />
            {sections.length > 1 && (
              <button type="button" className="wf-link-btn" onClick={() => onSections(sections.filter((s) => s.id !== sec.id))}>
                Remove section
              </button>
            )}
          </div>
          {sec.rows.map((row) => (
            <div key={row.id} className="wf-tpl-row2">
              <input
                className="wf-modal-input"
                placeholder="Row title"
                value={row.title}
                onChange={(e) =>
                  onSections(
                    sections.map((s) =>
                      s.id === sec.id
                        ? {
                            ...s,
                            rows: s.rows.map((r) => (r.id === row.id ? { ...r, title: e.target.value } : r)),
                          }
                        : s,
                    ),
                  )
                }
              />
              <input
                className="wf-modal-input"
                placeholder="Description (optional)"
                value={row.description}
                onChange={(e) =>
                  onSections(
                    sections.map((s) =>
                      s.id === sec.id
                        ? {
                            ...s,
                            rows: s.rows.map((r) =>
                              r.id === row.id ? { ...r, description: e.target.value } : r,
                            ),
                          }
                        : s,
                    ),
                  )
                }
              />
            </div>
          ))}
          {totalRows < 10 && (
            <button
              type="button"
              className="wf-btn ghost"
              onClick={() =>
                onSections(
                  sections.map((s) =>
                    s.id === sec.id
                      ? {
                          ...s,
                          rows: [...s.rows, { id: crypto.randomUUID(), title: '', description: '' }],
                        }
                      : s,
                  ),
                )
              }
            >
              + Add row
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        className="wf-btn ghost"
        onClick={() =>
          onSections([
            ...sections,
            {
              id: crypto.randomUUID(),
              title: `Section ${sections.length + 1}`,
              rows: [{ id: crypto.randomUUID(), title: '', description: '' }],
            },
          ])
        }
      >
        + Add section
      </button>
    </div>
  );
}
