import React, { useEffect, useMemo, useState } from 'react';
import { sendToBackground } from '../lib/messaging';
import type { ExtensionSettings } from '../lib/storage';
import { DEFAULT_SETTINGS } from '../lib/storage';
import { assessPacingRisk, PACING_BOUNDS } from '../lib/pacing';

export default function Options() {
  const [settings, setSettings] = useState<ExtensionSettings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [validationErrors, setValidationErrors] = useState<{ delay?: string; batchSize?: string }>({});

  const pacingRisk = useMemo(() => assessPacingRisk(settings), [settings]);

  useEffect(() => {
    sendToBackground<ExtensionSettings>('GET_SETTINGS').then(setSettings).catch(() => {});
  }, []);

  async function handleSave() {
    const errors: { delay?: string; batchSize?: string } = {};
    if (settings.delayPreset === 'custom' && settings.customDelaySeconds < PACING_BOUNDS.delaySecMin) {
      errors.delay = `Delay must be at least ${PACING_BOUNDS.delaySecMin} second(s).`;
    }
    if (settings.batchSize < PACING_BOUNDS.batchMin) {
      errors.batchSize = `Batch size must be at least ${PACING_BOUNDS.batchMin}.`;
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }
    setValidationErrors({});
    await sendToBackground('SAVE_SETTINGS', settings as unknown as Record<string, unknown>);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  function field(label: string, node: React.ReactNode, error?: string) {
    return (
      <div style={{ marginBottom: '16px' }}>
        <label style={{ display: 'block', fontWeight: 600, marginBottom: '4px', color: '#a1a1aa' }}>{label}</label>
        {node}
        {error && <div style={{ color: '#ff3b30', fontSize: '12px', marginTop: '3px' }}>{error}</div>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '560px', margin: '0 auto', padding: '24px', fontFamily: '"Comic Relief", "Comic Sans MS", cursive, system-ui, sans-serif', fontSize: '14px', background: '#0a0a0a', color: '#fafafa', minHeight: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '24px' }}>
        <svg width="24" height="24" viewBox="0 0 72 72" fill="none">
          <path d="M36 12L60 24L36 36L12 24L36 12Z" fill="#10b981" opacity="0.9"/>
          <path d="M60 32L36 44L12 32" stroke="#34d399" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M60 42L36 54L12 42" stroke="#6ee7b7" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <h1 style={{ fontSize: '20px', margin: 0 }}>Send<span style={{ color: '#34d399' }}>Stack</span> — Options</h1>
      </div>

      <div style={{ background: pacingRisk.bg, border: `1px solid ${pacingRisk.border}`, borderRadius: '8px', padding: '12px 14px', marginBottom: '20px' }}>
        <div style={{ fontWeight: 600, color: pacingRisk.color }}>
          {pacingRisk.level === 'safe' ? '✓' : '⚠️'} {pacingRisk.title} · score {pacingRisk.score}/100 · ~{pacingRisk.estimatedMsgPerHour} msg/hr
        </div>
        <p style={{ margin: '6px 0 0', color: '#a1a1aa', fontSize: '13px', lineHeight: 1.45 }}>{pacingRisk.message}</p>
        {(pacingRisk.level === 'aggressive' || pacingRisk.level === 'critical') && (
          <p style={{ margin: '8px 0 0', color: pacingRisk.color, fontSize: '12px' }}>
            Lower delays send more messages, but spam-like pacing may get your WhatsApp number blocked.
          </p>
        )}
      </div>

      {field('Default Mode', (
        <select value={settings.defaultMode} onChange={(e) => setSettings({ ...settings, defaultMode: e.target.value as ExtensionSettings['defaultMode'] })} style={{ width: '100%', padding: '6px', background: '#171717', color: '#fafafa', border: '1px solid #262626', borderRadius: '6px' }}>
          <option value="email">Email</option>
          <option value="whatsapp">WhatsApp</option>
        </select>
      ))}

      {field('Delay Preset', (
        <select value={settings.delayPreset} onChange={(e) => setSettings({ ...settings, delayPreset: e.target.value as ExtensionSettings['delayPreset'] })} style={{ width: '100%', padding: '6px', background: '#171717', color: '#fafafa', border: '1px solid #262626', borderRadius: '6px' }}>
          <option value="turbo">Turbo (2 s) — high ban risk</option>
          <option value="fast">Fast (5 s)</option>
          <option value="normal">Normal (10 s)</option>
          <option value="safe">Safe (15 s)</option>
          <option value="custom">Custom</option>
        </select>
      ))}

      {settings.delayPreset === 'custom' && field(`Custom Delay (seconds, min ${PACING_BOUNDS.delaySecMin})`, (
        <input type="number" min={PACING_BOUNDS.delaySecMin} max={PACING_BOUNDS.delaySecMax} value={settings.customDelaySeconds}
          onChange={(e) => setSettings({ ...settings, customDelaySeconds: Number(e.target.value) })}
          style={{ width: '100%', padding: '6px', background: '#171717', color: '#fafafa', border: '1px solid', borderColor: validationErrors.delay ? '#ff3b30' : '#262626', borderRadius: '6px' }} />
      ), validationErrors.delay)}

      {field('Random Jitter', (
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#a1a1aa' }}>
          <input type="checkbox" checked={settings.jitterEnabled} onChange={(e) => setSettings({ ...settings, jitterEnabled: e.target.checked })} />
          Enable ±30–50% random delay variation (recommended)
        </label>
      ))}

      {field(`Batch Size (${PACING_BOUNDS.batchMin}–${PACING_BOUNDS.batchMax})`, (
        <input type="number" min={PACING_BOUNDS.batchMin} max={PACING_BOUNDS.batchMax} value={settings.batchSize}
          onChange={(e) => setSettings({ ...settings, batchSize: Number(e.target.value) })}
          style={{ width: '100%', padding: '6px', background: '#171717', color: '#fafafa', border: '1px solid', borderColor: validationErrors.batchSize ? '#ff3b30' : '#262626', borderRadius: '6px' }} />
      ), validationErrors.batchSize)}

      {field('Batch Cool-down (seconds, 0 = none)', (
        <input type="number" min={PACING_BOUNDS.cooldownSecMin} max={PACING_BOUNDS.cooldownSecMax} value={settings.cooldownSeconds}
          onChange={(e) => setSettings({ ...settings, cooldownSeconds: Number(e.target.value) })}
          style={{ width: '100%', padding: '6px', background: '#171717', color: '#fafafa', border: '1px solid #262626', borderRadius: '6px' }} />
      ))}

      {field(`Daily Message Limit (max ${PACING_BOUNDS.dailyLimitMax})`, (
        <input type="number" min={PACING_BOUNDS.dailyLimitMin} max={PACING_BOUNDS.dailyLimitMax} value={settings.dailyLimit}
          onChange={(e) => setSettings({ ...settings, dailyLimit: Number(e.target.value) })}
          style={{ width: '100%', padding: '6px', background: '#171717', color: '#fafafa', border: '1px solid #262626', borderRadius: '6px' }} />
      ))}

      {field('Spin Syntax', (
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#a1a1aa' }}>
          <input type="checkbox" checked={settings.spinSyntaxEnabled} onChange={(e) => setSettings({ ...settings, spinSyntaxEnabled: e.target.checked })} />
          Enable spin syntax {'{A|B|C}'} (recommended)
        </label>
      ))}

      {field('Sidebar Position', (
        <select value={settings.sidebarPosition} onChange={(e) => setSettings({ ...settings, sidebarPosition: e.target.value as ExtensionSettings['sidebarPosition'] })} style={{ width: '100%', padding: '6px', background: '#171717', color: '#fafafa', border: '1px solid #262626', borderRadius: '6px' }}>
          <option value="right">Right</option>
          <option value="left">Left</option>
        </select>
      ))}

      <button onClick={handleSave} style={{ padding: '10px 24px', background: '#10b981', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '15px' }}>
        {saved ? 'Saved!' : 'Save Settings'}
      </button>
    </div>
  );
}
