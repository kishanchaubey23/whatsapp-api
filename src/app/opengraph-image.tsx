import { ImageResponse } from 'next/og';

export const runtime = 'edge';
export const alt = 'Loopx — Bulk Email & WhatsApp Messaging Platform';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          background: 'linear-gradient(135deg, #0a0a0a 0%, #0f281e 50%, #061e14 100%)',
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: '60px',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '32px',
          }}
        >
          <div
            style={{
              width: '64px',
              height: '64px',
              borderRadius: '16px',
              background: '#25D366',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '32px',
              color: 'white',
              fontWeight: 'bold',
            }}
          >
            L
          </div>
          <span
            style={{
              fontSize: '48px',
              fontWeight: 'bold',
              color: 'white',
              letterSpacing: '-1px',
            }}
          >
            Loopx
          </span>
        </div>

        <div
          style={{
            fontSize: '28px',
            color: '#86efac',
            textAlign: 'center',
            maxWidth: '800px',
            lineHeight: 1.4,
            marginBottom: '24px',
          }}
        >
          Bulk Email & WhatsApp Messaging Platform
        </div>

        <div
          style={{
            fontSize: '18px',
            color: '#94a3b8',
            textAlign: 'center',
            maxWidth: '700px',
            lineHeight: 1.5,
            marginBottom: '40px',
          }}
        >
          Upload a CSV, personalize with template variables, and send at scale.
          Secure, fast, and reliable.
        </div>

        <div
          style={{
            display: 'flex',
            gap: '16px',
          }}
        >
          {['SMTP Email', 'WhatsApp', 'Spin Syntax', 'Anti-Ban', 'Multilingual'].map(
            (tag) => (
              <div
                key={tag}
                style={{
                  background: 'rgba(37, 211, 102, 0.15)',
                  border: '1px solid rgba(37, 211, 102, 0.3)',
                  borderRadius: '20px',
                  padding: '8px 20px',
                  color: '#86efac',
                  fontSize: '14px',
                  fontWeight: 500,
                }}
              >
                {tag}
              </div>
            )
          )}
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: '30px',
            right: '40px',
            fontSize: '14px',
            color: '#22c55e',
          }}
        >
          powered by Loopanda
        </div>
      </div>
    ),
    { ...size }
  );
}
