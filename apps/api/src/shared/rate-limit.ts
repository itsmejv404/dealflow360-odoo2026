import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { Request } from 'express';
import { redis } from '../lib/redis.js';

export interface TenantRateLimitOptions {
  /** Sliding window in milliseconds. Default: 60s. */
  windowMs?: number;
  /** Max requests per window per org+subject. Default: 30. */
  max?: number;
  /** Redis key prefix. Default: 'rl:'. */
  keyPrefix?: string;
  /** Human-readable message for the 429 response. */
  message?: string;
}

/**
 * Redis-backed rate limiter keyed by `org_id + subject` (customer id / user id),
 * per the multi-tenancy rules: rate-limit buckets are scoped per tenant.
 *
 * MUST be registered AFTER tenantContextMiddleware so `req.tenant` is available.
 */
export function tenantRateLimit(options: TenantRateLimitOptions = {}) {
  const { windowMs = 60_000, max = 30, keyPrefix = 'rl:', message = 'Too many requests. Please slow down and try again shortly.' } = options;

  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    store: new RedisStore({
      // Bridge the express-rate-limit store to the shared ioredis singleton.
      sendCommand: (...args: string[]) =>
        redis.call(...(args as [string, ...string[]])) as unknown as Promise<any>,
      prefix: keyPrefix,
    }),
    keyGenerator: (req: Request) => {
      const tenant = req.tenant;
      const subject = tenant?.userId || tenant?.email || 'anonymous';
      return `${tenant?.orgId ?? 'unknown'}:${subject}`;
    },
    handler: (_req, res) => {
      // Matches the global error shape: { error: "..." }
      res.status(429).json({ error: message });
    },
  });
}
