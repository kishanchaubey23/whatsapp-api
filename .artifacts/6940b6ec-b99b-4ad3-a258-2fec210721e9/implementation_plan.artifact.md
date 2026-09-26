# Implementation Plan - WhatsApp Cache Clearing & Phone Number Pairing Code Connection

Implement cache clearing for corrupted WhatsApp sessions/cache and add full support for connecting WhatsApp using a phone number pairing code via `whatsapp-web.js` (`client.requestPairingCode`).

## User Review Required

> [!IMPORTANT]
> This plan adds cache clearing utilities and pairing code login support to both the backend client manager (`whatsapp-client.ts`) and the frontend UI (`DevicesPanel.tsx`).

## Open Questions

- None. `whatsapp-web.js` natively supports `client.requestPairingCode(phoneNumber)`.

## Proposed Changes

### Backend / Client Logic

#### [MODIFY] [whatsapp-client.ts](file:///C:/Users/chaub/AndroidStudioProjects/whatsapp-bulk-api/src/lib/whatsapp-client.ts)
- Add `clearAllCaches()` utility to remove `.wwebjs_auth`, `.wwebjs_cache`, and tmp auth directories.
- Add `pairingCode` state tracking to `WAClientState` and `getPairingCode()` getter.
- Add `requestPairingCode(phoneNumber: string): Promise<string>` method that initializes the client if needed and calls `client.requestPairingCode(cleanPhone)`.

### API Routes

#### [NEW] [route.ts](file:///C:/Users/chaub/AndroidStudioProjects/whatsapp-bulk-api/src/app/api/whatsapp/clear-cache/route.ts)
- POST endpoint to clear all local auth and cache folders and reset client state.

#### [NEW] [route.ts](file:///C:/Users/chaub/AndroidStudioProjects/whatsapp-bulk-api/src/app/api/whatsapp/pairing-code/route.ts)
- POST endpoint to accept `{ phone, sessionId }` and invoke `requestPairingCode()`, returning the 8-character pairing code.

### Frontend UI

#### [MODIFY] [DevicesPanel.tsx](file:///C:/Users/chaub/AndroidStudioProjects/whatsapp-bulk-api/src/components/DevicesPanel.tsx)
- Add "Clear Cache & Reset" button to clear sessions/cache.
- Implement phone number pairing code submission in the phone modal (`modal.mode === 'phone'`), calling `/api/whatsapp/pairing-code` and displaying the generated pairing code to the user with step-by-step instructions.
- Poll pairing code status or status endpoint to detect successful connection.

## Verification Plan

### Automated Tests
- Test API route compilation and TypeScript build (`npm run build`).

### Manual Verification
- Test "Clear Cache & Reset" from the Devices panel.
- Test "Use Pairing Code Instead", enter phone number, submit, and verify that the 8-character pairing code is generated and displayed correctly.
