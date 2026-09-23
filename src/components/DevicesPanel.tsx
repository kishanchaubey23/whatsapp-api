'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';

type WAStatus =
  | 'disconnected'
  | 'reconnecting'
  | 'qr'
  | 'verifying'
  | 'ready'
  | 'rejected'
  | 'initializing'
  | 'already_connected';

type ProfileReport = {
  allowed: boolean;
  rejectionReason: string | null;
  phone?: string;
  pushname?: string;
  businessName?: string | null;
  isBusiness?: boolean;
  isEnterprise?: boolean;
};

type Device = {
  id: string;
  name: string;
  sessionId: string;
  status: 'qr_ready' | 'connecting' | 'connected' | 'disconnected';
  phone?: string;
  businessName?: string;
  createdAt: string;
  isDefault?: boolean;
};

type Modal =
  | { type: 'none' }
  | { type: 'name' }
  | { type: 'device'; deviceId: string; mode: 'menu' | 'qr' | 'phone' }
  | { type: 'success'; deviceId: string };

const STORAGE_KEY = 'whatsflow_devices_v2';

function loadDevices(): Device[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Device[]) : [];
  } catch {
    return [];
  }
}

function saveDevices(list: Device[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function makeSessionId(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 10) || 'device';
  const rand = Math.random().toString(36).slice(2, 10);
  return `session_${Date.now()}_${slug}_${rand}`;
}

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'numeric',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

const COUNTRIES = [
  { code: 'IN', name: 'India', dial: '+91', flag: '🇮🇳' },
  { code: 'US', name: 'United States', dial: '+1', flag: '🇺🇸' },
  { code: 'GB', name: 'United Kingdom', dial: '+44', flag: '🇬🇧' },
  { code: 'AE', name: 'UAE', dial: '+971', flag: '🇦🇪' },
  { code: 'SA', name: 'Saudi Arabia', dial: '+966', flag: '🇸🇦' },
];

export default function DevicesPanel() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [modal, setModal] = useState<Modal>({ type: 'none' });
  const [deviceName, setDeviceName] = useState('');
  const [qr, setQr] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<WAStatus>('disconnected');
  const [liveSessionId, setLiveSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successCountdown, setSuccessCountdown] = useState(2);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [phoneLocal, setPhoneLocal] = useState('');
  const [showCountry, setShowCountry] = useState(false);
  /** Session IDs that already showed the success modal (don't reopen on poll) */
  const successShownRef = useRef<Set<string>>(new Set());
  /** Only open success when we were actively connecting this session */
  const awaitingConnectRef = useRef<string | null>(null);

  useEffect(() => {
    setDevices(loadDevices());
  }, []);

  const updateDevice = useCallback((id: string, patch: Partial<Device>) => {
    setDevices((prev) => {
      const next = prev.map((d) => (d.id === id ? { ...d, ...patch } : d));
      saveDevices(next);
      return next;
    });
  }, []);

  const removeDevice = useCallback((id: string) => {
    setDevices((prev) => {
      const next = prev.filter((d) => d.id !== id);
      saveDevices(next);
      return next;
    });
  }, []);

  const poll = useCallback(async () => {
    try {
      const [stRes, qrRes] = await Promise.all([
        fetch('/api/whatsapp/status'),
        fetch('/api/whatsapp/qr'),
      ]);
      if (stRes.ok) {
        const st = (await stRes.json()) as {
          status: WAStatus;
          sessionId?: string | null;
          phone?: string;
          name?: string;
          error?: string;
          profile?: ProfileReport;
        };
        setLiveStatus(st.status);
        setLiveSessionId(st.sessionId ?? null);

        if (st.sessionId) {
          const patchStatus = (status: Device['status'], extra?: Partial<Device>) => {
            setDevices((prev) => {
              const next = prev.map((d) =>
                d.sessionId === st.sessionId ? { ...d, status, ...extra } : d,
              );
              saveDevices(next);
              return next;
            });
          };

          if (st.status === 'qr' || st.status === 'reconnecting') {
            patchStatus('qr_ready');
          }
          if (st.status === 'verifying') {
            patchStatus('connecting');
          }

          if (st.status === 'ready' && st.profile?.allowed) {
            const phone = st.profile.phone || st.phone;
            const businessName =
              st.profile.businessName || st.profile.pushname || st.name || undefined;
            patchStatus('connected', {
              phone: phone || undefined,
              businessName,
            });
            // Show success once only when this session was just connecting
            const sid = st.sessionId;
            const wasAwaiting = awaitingConnectRef.current === sid;
            const alreadyShown = sid ? successShownRef.current.has(sid) : true;
            if (sid && wasAwaiting && !alreadyShown) {
              successShownRef.current.add(sid);
              awaitingConnectRef.current = null;
              const dev = loadDevices().find((d) => d.sessionId === sid);
              if (dev) setModal({ type: 'success', deviceId: dev.id });
            }
          }

          if (st.status === 'rejected') {
            const msg =
              st.profile?.rejectionReason ||
              st.error ||
              'Personal WhatsApp is not allowed. Use WhatsApp Business.';
            setError(msg);
            if (!(window as unknown as { __wfReject?: string }).__wfReject ||
              (window as unknown as { __wfReject?: string }).__wfReject !== st.sessionId) {
              (window as unknown as { __wfReject?: string }).__wfReject = st.sessionId || '';
              window.alert(`⚠️ Business account required\n\n${msg}`);
            }
            patchStatus('qr_ready');
          }

          if (st.error && st.status !== 'ready') setError(st.error);
        }
      }
      if (qrRes.ok) {
        const q = (await qrRes.json()) as { qr: string | null };
        setQr(q.qr);
      }
    } catch {
      /* ignore */
    }
  }, [updateDevice]);

  useEffect(() => {
    void poll();
    const t = setInterval(() => void poll(), 2500);
    return () => clearInterval(t);
  }, [poll]);

  // Success auto-close countdown (once per open)
  useEffect(() => {
    if (modal.type !== 'success') return;
    setSuccessCountdown(2);
    let left = 2;
    const tick = setInterval(() => {
      left -= 1;
      setSuccessCountdown(left);
      if (left <= 0) {
        clearInterval(tick);
        setModal({ type: 'none' });
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [modal.type === 'success' ? (modal as { deviceId: string }).deviceId : '']);

  function openAddName() {
    setDeviceName('');
    setError(null);
    setModal({ type: 'name' });
  }

  function createDevice() {
    const name = deviceName.trim();
    if (!name) {
      setError('Enter a device name.');
      return;
    }
    const sessionId = makeSessionId(name);
    const device: Device = {
      id: crypto.randomUUID(),
      name,
      sessionId,
      status: 'qr_ready',
      createdAt: new Date().toISOString(),
      isDefault: devices.length === 0,
    };
    const next = [device, ...devices];
    setDevices(next);
    saveDevices(next);
    setModal({ type: 'device', deviceId: device.id, mode: 'menu' });
    setError(null);
  }

  async function startSession(device: Device) {
    setError(null);
    // Allow success modal for this fresh connect attempt
    successShownRef.current.delete(device.sessionId);
    awaitingConnectRef.current = device.sessionId;
    updateDeviceBySession(device.sessionId, { status: 'connecting' });
    try {
      await fetch('/api/whatsapp/init', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: device.sessionId }),
      });
      await poll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to start session');
      updateDeviceBySession(device.sessionId, { status: 'qr_ready' });
      awaitingConnectRef.current = null;
    }
  }

  function updateDeviceBySession(sessionId: string, patch: Partial<Device>) {
    setDevices((prev) => {
      const next = prev.map((d) => (d.sessionId === sessionId ? { ...d, ...patch } : d));
      saveDevices(next);
      return next;
    });
  }

  async function showQr(device: Device) {
    setModal({ type: 'device', deviceId: device.id, mode: 'qr' });
    await startSession(device);
  }

  async function showPhone(device: Device) {
    setModal({ type: 'device', deviceId: device.id, mode: 'phone' });
    await startSession(device);
  }

  async function disconnectDevice(device: Device) {
    successShownRef.current.delete(device.sessionId);
    if (awaitingConnectRef.current === device.sessionId) {
      awaitingConnectRef.current = null;
    }
    try {
      await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearSession: false, sessionId: device.sessionId }),
      });
    } catch {
      /* ignore */
    }
    updateDevice(device.id, { status: 'disconnected', phone: device.phone });
  }

  async function deleteDevice(device: Device) {
    if (!window.confirm(`Delete device “${device.name}”? This clears its session.`)) return;
    successShownRef.current.delete(device.sessionId);
    if (awaitingConnectRef.current === device.sessionId) {
      awaitingConnectRef.current = null;
    }
    try {
      await fetch('/api/whatsapp/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clearSession: true, sessionId: device.sessionId }),
      });
    } catch {
      /* ignore */
    }
    removeDevice(device.id);
    if (modal.type !== 'none' && 'deviceId' in modal && modal.deviceId === device.id) {
      setModal({ type: 'none' });
    }
  }

  const activeDevice =
    modal.type === 'device' || modal.type === 'success'
      ? devices.find((d) => d.id === modal.deviceId)
      : undefined;

  return (
    <div className="wf-devices">
      {/* Header */}
      <div className="wf-devices-head">
        <div>
          <h1>WhatsApp Devices</h1>
          <p>Link and manage WhatsApp Business sessions. Personal accounts are blocked.</p>
        </div>
        <button type="button" className="wf-add-device-btn" onClick={openAddName}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          Add Device
        </button>
      </div>

      {/* Empty state */}
      {devices.length === 0 && modal.type === 'none' && (
        <div className="wf-dev-empty">
          <div className="wf-dev-empty-icon" aria-hidden>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="5" y="2" width="14" height="20" rx="2.5" />
              <path d="M9 18h6" strokeLinecap="round" />
              <path d="M8 8h8M8 11h5" strokeLinecap="round" opacity="0.5" />
            </svg>
            <span className="wf-dev-qr-badge">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M4 4h6v6H4V4zm10 0h6v6h-6V4zM4 14h6v6H4v-6zm10 3h3v3h-3v-3zm3-3h3v3h-3v-3z" />
              </svg>
            </span>
          </div>
          <h2>No devices connected</h2>
          <p>Add your first WhatsApp Business device to start messaging.</p>
          <button type="button" className="wf-add-device-btn" onClick={openAddName}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            Add Device
          </button>
        </div>
      )}

      {/* Device cards grid */}
      {devices.length > 0 && (
        <div className="wf-dev-grid">
          {devices.map((d) => {
            const live =
              liveSessionId === d.sessionId &&
              (liveStatus === 'ready' || liveStatus === 'qr' || liveStatus === 'verifying');
            const connected = d.status === 'connected' || (live && liveStatus === 'ready');
            const qrReady = d.status === 'qr_ready' || d.status === 'connecting' || (live && liveStatus === 'qr');

            return (
              <article key={d.id} className="wf-dev-card">
                <div className="wf-dev-card-top">
                  <div className="wf-dev-card-title">
                    <i className={connected ? 'dot on' : 'dot'} />
                    <div>
                      <strong>{d.name}</strong>
                      <code>{d.sessionId}</code>
                    </div>
                  </div>
                  <div className="wf-dev-card-top-right">
                    {connected ? (
                      <span className="wf-pill ok">Connected</span>
                    ) : qrReady ? (
                      <span className="wf-pill warn">QR Code Ready</span>
                    ) : (
                      <span className="wf-pill muted">Disconnected</span>
                    )}
                    <button
                      type="button"
                      className="wf-icon-trash"
                      aria-label="Delete device"
                      onClick={() => void deleteDevice(d)}
                    >
                      🗑
                    </button>
                  </div>
                </div>

                <div className="wf-dev-meta">
                  <div>
                    <span>Status:</span>
                    <strong className={connected ? 'ok' : ''}>
                      {connected ? '✓ Connected' : qrReady ? '⏱ QR Code Ready' : '○ Disconnected'}
                    </strong>
                  </div>
                  {connected && d.phone && (
                    <div>
                      <span>Phone:</span>
                      <strong>+{d.phone}</strong>
                    </div>
                  )}
                  {d.businessName && connected && (
                    <div>
                      <span>Business:</span>
                      <strong>{d.businessName}</strong>
                    </div>
                  )}
                  <div>
                    <span>Created:</span>
                    <strong>{formatDate(d.createdAt)}</strong>
                  </div>
                </div>

                {connected ? (
                  <div className="wf-dev-actions">
                    <button type="button" className="wf-btn orange" onClick={() => void disconnectDevice(d)}>
                      ✕ Disconnect
                    </button>
                    <button type="button" className="wf-btn red" onClick={() => void deleteDevice(d)}>
                      🗑 Delete
                    </button>
                  </div>
                ) : (
                  <div className="wf-dev-actions">
                    <button
                      type="button"
                      className="wf-btn blue"
                      onClick={() => void showQr(d)}
                    >
                      ▦ Show QR Code
                    </button>
                    <button
                      type="button"
                      className="wf-btn green"
                      onClick={() => void showPhone(d)}
                    >
                      Use Pairing Code Instead
                    </button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {/* Modal: device name */}
      {modal.type === 'name' && (
        <div className="wf-modal-backdrop" role="dialog" aria-modal>
          <div className="wf-modal">
            <h3>Create device</h3>
            <p>Give this WhatsApp session a name (e.g. office, sales, Rahul).</p>
            <input
              className="wf-modal-input"
              placeholder="Device name"
              value={deviceName}
              autoFocus
              onChange={(e) => setDeviceName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createDevice()}
            />
            {error && <p className="wf-modal-error">{error}</p>}
            <div className="wf-modal-actions">
              <button type="button" className="wf-btn ghost" onClick={() => setModal({ type: 'none' })}>
                Cancel
              </button>
              <button type="button" className="wf-btn green" onClick={createDevice}>
                Create Device (QR Scan)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: device connect menu / QR / phone */}
      {modal.type === 'device' && activeDevice && (
        <div className="wf-modal-backdrop" role="dialog" aria-modal>
          <div className={`wf-modal ${modal.mode === 'qr' ? 'wide' : ''}`}>
            <div className="wf-modal-head">
              <div className="wf-dev-card-title">
                <i className={activeDevice.status === 'connected' ? 'dot on' : 'dot'} />
                <div>
                  <strong>{activeDevice.name}</strong>
                  <code>{activeDevice.sessionId}</code>
                </div>
              </div>
              <button type="button" className="wf-modal-x" onClick={() => setModal({ type: 'none' })}>
                ✕
              </button>
            </div>

            {modal.mode === 'menu' && (
              <>
                <div className="wf-dev-meta pad">
                  <div>
                    <span>Status:</span>
                    <strong>⏱ QR Code Ready</strong>
                  </div>
                  <div>
                    <span>Created:</span>
                    <strong>{formatDate(activeDevice.createdAt)}</strong>
                  </div>
                </div>
                <div className="wf-dev-actions">
                  <button type="button" className="wf-btn blue" onClick={() => void showQr(activeDevice)}>
                    ▦ Show QR Code
                  </button>
                  <button type="button" className="wf-btn green" onClick={() => void showPhone(activeDevice)}>
                    Use Pairing Code Instead
                  </button>
                </div>
              </>
            )}

            {modal.mode === 'qr' && (
              <div className="wf-modal-qr">
                <div className="wf-wa-qr-box light">
                  {liveStatus === 'verifying' ? (
                    <div className="wf-wa-qr-loading">
                      <div className="wf-spin" />
                      <p>Verifying Business account…</p>
                    </div>
                  ) : qr ? (
                    <Image src={qr} alt="WhatsApp QR" width={240} height={240} unoptimized className="wf-wa-qr-img" />
                  ) : (
                    <div className="wf-wa-qr-loading">
                      <div className="wf-spin" />
                      <p>Generating QR…</p>
                    </div>
                  )}
                </div>
                <ol className="wf-wa-steps compact">
                  <li><span>1</span> Open WhatsApp Business → Linked devices</li>
                  <li><span>2</span> Tap Link a device</li>
                  <li><span>3</span> Scan this QR code</li>
                </ol>
                <button type="button" className="wf-wa-switch-link" onClick={() => setModal({ type: 'device', deviceId: activeDevice.id, mode: 'phone' })}>
                  Log in with phone number ›
                </button>
                {error && <div className="wf-wa-error">{error}</div>}
              </div>
            )}

            {modal.mode === 'phone' && (
              <div className="wf-wa-phone-layout compact">
                <h2>Enter phone number</h2>
                <p className="wf-wa-sub">Select a country and enter your WhatsApp Business number.</p>
                <div className="wf-wa-phone-fields">
                  <div className="wf-wa-select-wrap">
                    <button type="button" className="wf-wa-select" onClick={() => setShowCountry((v) => !v)}>
                      <span>{country.flag} {country.name}</span>
                      <span>▾</span>
                    </button>
                    {showCountry && (
                      <ul className="wf-wa-select-menu">
                        {COUNTRIES.map((c) => (
                          <li key={c.code}>
                            <button type="button" onClick={() => { setCountry(c); setShowCountry(false); }}>
                              {c.flag} {c.name} ({c.dial})
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="wf-wa-phone-input">
                    <span>{country.dial}</span>
                    <input
                      type="tel"
                      value={phoneLocal}
                      placeholder="Phone number"
                      onChange={(e) => setPhoneLocal(e.target.value.replace(/[^\d\s-]/g, ''))}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  className="wf-wa-next"
                  onClick={() => {
                    window.alert(
                      'Pairing-code login is coming next. Please use Show QR Code with WhatsApp Business for now.',
                    );
                    void showQr(activeDevice);
                  }}
                >
                  Next
                </button>
                <button
                  type="button"
                  className="wf-wa-switch-link center"
                  onClick={() => void showQr(activeDevice)}
                >
                  Log in with QR code ›
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Success modal */}
      {modal.type === 'success' && activeDevice && (
        <div className="wf-modal-backdrop" role="dialog" aria-modal>
          <div className="wf-modal success">
            <div className="wf-modal-head">
              <strong className="ok-title">✓ Connected!</strong>
              <button type="button" className="wf-modal-x" onClick={() => setModal({ type: 'none' })}>
                ✕
              </button>
            </div>
            <div className="wf-success-box">
              <div className="wf-success-check">✓</div>
              <strong>Connected!</strong>
              <p>
                Successfully connected!
                {successCountdown > 0 ? ` Closing in ${successCountdown} seconds…` : ''}
              </p>
            </div>
            <h3>Successfully Connected!</h3>
            <p className="wf-success-sub">
              Your WhatsApp session is now connected and ready to use.
              {activeDevice.phone ? ` (+${activeDevice.phone})` : ''}
            </p>
            <button type="button" className="wf-btn green full" onClick={() => setModal({ type: 'none' })}>
              Continue
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
