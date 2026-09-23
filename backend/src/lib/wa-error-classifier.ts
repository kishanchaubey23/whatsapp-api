/**
 * Classify WhatsApp / Puppeteer errors for MessageWorker fallbacks.
 */

export type WaErrorCategory =
  | 'target_blocked'
  | 'session_dead'
  | 'rate_limited'
  | 'not_registered'
  | 'transient'
  | 'unknown';

export type ClassifiedWaError = {
  category: WaErrorCategory;
  message: string;
  /** Protection Engine score delta (positive = more risk) */
  riskDelta: number;
  /** Fatal to the whole campaign / account session */
  isSessionFatal: boolean;
  /** Per-contact only — continue loop */
  isContactLevel: boolean;
};

const TARGET_BLOCKED_RE =
  /contact blocked|blocked you|blocked the contact|not-authorized|not authorized|forbidden|401|403|cannot send|can't send|unable to send|privacy|user is blocked|blocked by|recipient blocked/i;

const SESSION_DEAD_RE =
  /session closed|execution context was destroyed|protocol error|target closed|browser has disconnected|websocket is not open|page crashed|session logged out|account banned|account suspended|banned|suspended|logged out|client is not ready|not connected|puppeteer.*disconnected|browser.*disconnected|frame was detached|no target with given id|connection closed|econnreset|navigating frame was detached/i;

const RATE_LIMIT_RE = /rate.?limit|too many|try again later|spam|flood/i;

const NOT_REGISTERED_RE = /not registered|not a whatsapp|no wid|invalid wid|phone number.*not/i;

export function classifyWaError(err: unknown): ClassifiedWaError {
  const message =
    err instanceof Error
      ? `${err.name}: ${err.message}${err.stack ? ` | ${err.stack.slice(0, 200)}` : ''}`
      : String(err);

  if (TARGET_BLOCKED_RE.test(message)) {
    return {
      category: 'target_blocked',
      message,
      riskDelta: 4,
      isSessionFatal: false,
      isContactLevel: true,
    };
  }

  if (SESSION_DEAD_RE.test(message)) {
    const banned = /banned|suspended/i.test(message);
    return {
      category: 'session_dead',
      message,
      riskDelta: banned ? 40 : 25,
      isSessionFatal: true,
      isContactLevel: false,
    };
  }

  if (RATE_LIMIT_RE.test(message)) {
    return {
      category: 'rate_limited',
      message,
      riskDelta: 12,
      isSessionFatal: false,
      isContactLevel: true,
    };
  }

  if (NOT_REGISTERED_RE.test(message)) {
    return {
      category: 'not_registered',
      message,
      riskDelta: 1,
      isSessionFatal: false,
      isContactLevel: true,
    };
  }

  // Structural evaluation failures often mean dead context
  if (/evaluate|Runtime\.callFunctionOn|Session closed|Target\.closeTarget/i.test(message)) {
    return {
      category: 'session_dead',
      message,
      riskDelta: 22,
      isSessionFatal: true,
      isContactLevel: false,
    };
  }

  return {
    category: 'unknown',
    message,
    riskDelta: 3,
    isSessionFatal: false,
    isContactLevel: true,
  };
}
