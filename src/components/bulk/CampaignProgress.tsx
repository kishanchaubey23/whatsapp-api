'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { blastApi, type BlastBatch } from '@/lib/blast-api';

export default function CampaignProgress({ batchId }: { batchId: string }) {
  const [batch, setBatch] = useState<BlastBatch | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [toast, setToast] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await blastApi.get(batchId);
      setBatch(res.batch);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load campaign');
    } finally {
      setLoading(false);
    }
  }, [batchId]);

  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 4000);
    return () => clearInterval(t);
  }, [load]);

  // Optional Socket.IO if backend available
  useEffect(() => {
    let socket: { disconnect: () => void } | null = null;
    try {
      const token = localStorage.getItem('whatsflow_token') || sessionStorage.getItem('whatsflow_token');
      if (!token) return;
      // dynamic import optional — skip if socket.io-client not installed
      void import('socket.io-client')
        .then(({ io }) => {
          const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
          const s = io(base, { auth: { token } });
          s.on('event', (payload: { type?: string; batchId?: string }) => {
            if (payload?.batchId === batchId) void load();
            if (payload?.type === 'critical_session_alert') {
              setToast('Critical: WhatsApp session issue — campaign may be paused');
            }
          });
          socket = s;
        })
        .catch(() => undefined);
    } catch {
      /* no socket */
    }
    return () => {
      socket?.disconnect();
    };
  }, [batchId, load]);

  async function cancel() {
    if (!window.confirm('Cancel remaining jobs for this campaign?')) return;
    setCancelling(true);
    try {
      await blastApi.cancel(batchId);
      setToast('Cancel requested');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancel failed');
    } finally {
      setCancelling(false);
    }
  }

  if (loading && !batch) {
    return <p className="wf-ct-muted">Loading campaign…</p>;
  }

  if (!batch) {
    return (
      <div>
        <p className="wf-ct-error">{error || 'Campaign not found'}</p>
        <Link href="/dashboard/bulk">← Back to Bulk Messages</Link>
      </div>
    );
  }

  const name =
    (batch.payload && typeof batch.payload === 'object' && (batch.payload as { name?: string }).name) ||
    'Campaign';
  const pct =
    batch.totalNumbers > 0
      ? Math.min(100, Math.round((batch.processedCount / batch.totalNumbers) * 100))
      : 0;

  return (
    <div className="wf-bulk">
      <Link href="/dashboard/bulk" className="wf-ct-back">
        ← Back to Bulk Messages
      </Link>

      <div className="wf-devices-head">
        <div>
          <h1>{String(name)}</h1>
          <p>
            Status: <span className={`wf-bulk-status ${batch.status}`}>{batch.status}</span>
            {batch.whatsappAccount && (
              <>
                {' '}
                · Session {batch.whatsappAccount.label}
                {batch.whatsappAccount.phone ? ` (+${batch.whatsappAccount.phone})` : ''}
              </>
            )}
          </p>
        </div>
        {(batch.status === 'queued' || batch.status === 'processing') && (
          <button type="button" className="wf-btn orange" disabled={cancelling} onClick={() => void cancel()}>
            {cancelling ? 'Cancelling…' : 'Cancel remaining'}
          </button>
        )}
      </div>

      {toast && <div className="wf-ct-toast">{toast}</div>}
      {error && <div className="wf-ct-error">{error}</div>}
      {batch.lastError && (
        <div className="wf-ct-error">
          <strong>Backend note:</strong> {batch.lastError}
        </div>
      )}

      <div className="wf-bulk-progress-bar">
        <div style={{ width: `${pct}%` }} />
      </div>
      <p className="wf-ct-muted">{pct}% processed ({batch.processedCount}/{batch.totalNumbers})</p>

      <div className="wf-ct-stats">
        <div className="wf-ct-stat">
          <span>Total</span>
          <strong>{batch.totalNumbers}</strong>
        </div>
        <div className="wf-ct-stat">
          <span>Processed</span>
          <strong>{batch.processedCount}</strong>
        </div>
        <div className="wf-ct-stat ok">
          <span>Sent</span>
          <strong>{batch.sentCount}</strong>
        </div>
        <div className="wf-ct-stat ok">
          <span>Verified</span>
          <strong>{batch.verifiedCount}</strong>
        </div>
        <div className="wf-ct-stat bad">
          <span>Failed</span>
          <strong>{batch.failedCount}</strong>
        </div>
        <div className="wf-ct-stat warn">
          <span>Skipped</span>
          <strong>{batch.skippedCount}</strong>
        </div>
      </div>

      {batch.messageBody && (
        <div className="wf-bulk-list-card" style={{ marginTop: 16 }}>
          <h2>Message</h2>
          <pre className="wf-bulk-msg-preview">{batch.messageBody}</pre>
        </div>
      )}
    </div>
  );
}
