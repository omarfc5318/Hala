// lib/logger.ts — Structured, PII-safe logger
// NEVER pass: passwords, tokens, phone numbers, raw user IDs

import * as Sentry from '@sentry/react-native';
import * as Crypto from 'expo-crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlation_id?: string;
  user_id_hash?: string; // sha256 truncated — NEVER raw user_id
  action?: string;
  duration_ms?: number;
  error?: string;
}

type LogMeta = Partial<Omit<LogEntry, 'timestamp' | 'level' | 'message'>>;

// ---------------------------------------------------------------------------
// Correlation ID — set once per logical operation (e.g. screen load)
// ---------------------------------------------------------------------------

let _correlationId: string | undefined = undefined;

export function setCorrelationId(id: string): void {
  _correlationId = id;
}

export function generateCorrelationId(): string {
  return Math.random().toString(36).slice(2, 10).padStart(8, '0');
}

export function clearCorrelationId(): void {
  _correlationId = undefined;
}

// ---------------------------------------------------------------------------
// User ID hashing — call once after login, cache the result in context
// ---------------------------------------------------------------------------

/**
 * Returns the first 16 hex chars of SHA-256(userId).
 * Safe to include in logs — not reversible to the original ID.
 */
export async function hashUserId(userId: string): Promise<string> {
  const hex = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    userId,
    { encoding: Crypto.CryptoEncoding.HEX },
  );
  return hex.slice(0, 16);
}

// ---------------------------------------------------------------------------
// Core log function
// ---------------------------------------------------------------------------

function log(level: LogLevel, message: string, meta: LogMeta = {}): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(meta.correlation_id ?? _correlationId
      ? { correlation_id: meta.correlation_id ?? _correlationId }
      : {}),
    ...meta,
  };

  if (__DEV__) {
    // Pretty-print in dev console
    const prefix = level === 'error' ? '🔴' : level === 'warn' ? '🟡' : '🔵';
    console.log(`${prefix} [${level.toUpperCase()}] ${message}`, entry);
    return;
  }

  // Production: route to Sentry
  Sentry.addBreadcrumb({
    message,
    level: level as Sentry.SeverityLevel,
    data: meta,
    timestamp: Date.now() / 1000,
  });

  if (level === 'error') {
    Sentry.captureMessage(message, 'error');
  } else if (level === 'warn') {
    Sentry.captureMessage(message, 'warning');
  }
}

// ---------------------------------------------------------------------------
// Public logger — backward-compatible with logger.error('msg', err)
// ---------------------------------------------------------------------------

function toErrorString(e: unknown): string | undefined {
  if (e == null) return undefined;
  if (e instanceof Error) return e.message;
  return String(e);
}

export const logger = {
  debug: (msg: string, meta?: LogMeta): void => log('debug', msg, meta),
  info:  (msg: string, meta?: LogMeta): void => log('info', msg, meta),
  warn:  (msg: string, meta?: LogMeta): void => log('warn', msg, meta),

  /**
   * Accepts both:
   *   logger.error('msg', err)                   ← legacy call sites
   *   logger.error('msg', { action: 'x' })        ← structured meta
   *   logger.error('msg', err, { action: 'x' })   ← both
   */
  error: (msg: string, errOrMeta?: unknown, extraMeta?: LogMeta): void => {
    const isErrorLike =
      errOrMeta == null ||
      errOrMeta instanceof Error ||
      typeof errOrMeta !== 'object';

    if (isErrorLike) {
      log('error', msg, { ...extraMeta, error: toErrorString(errOrMeta) });
    } else {
      log('error', msg, errOrMeta as LogMeta);
    }
  },
};
