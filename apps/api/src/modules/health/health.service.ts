import { ListBucketsCommand } from '@aws-sdk/client-s3';
import { prisma } from '../../lib/prisma.js';
import { redis } from '../../lib/redis.js';
import { s3 } from '../../lib/minio.js';

export type ServiceStatus = 'up' | 'down';

export interface ServiceCheck {
  status: ServiceStatus;
  latencyMs: number;
}

export interface HealthReport {
  status: 'ok' | 'degraded';
  uptime: number;
  timestamp: string;
  services: {
    postgres: ServiceCheck;
    redis: ServiceCheck;
    minio: ServiceCheck;
  };
}

async function probe(fn: () => Promise<unknown>): Promise<ServiceCheck> {
  const start = performance.now();
  try {
    await fn();
    return { status: 'up', latencyMs: Math.round(performance.now() - start) };
  } catch {
    return { status: 'down', latencyMs: Math.round(performance.now() - start) };
  }
}

export async function getHealth(): Promise<HealthReport> {
  const [postgres, redisCheck, minio] = await Promise.all([
    probe(() => prisma.$queryRaw`SELECT 1`),
    probe(async () => {
      if (redis.status !== 'ready') await redis.connect();
      await redis.ping();
    }),
    probe(() => s3.send(new ListBucketsCommand({}))),
  ]);

  const allUp = [postgres, redisCheck, minio].every((s) => s.status === 'up');

  return {
    status: allUp ? 'ok' : 'degraded',
    uptime: Math.round(process.uptime() * 10) / 10,
    timestamp: new Date().toISOString(),
    services: { postgres, redis: redisCheck, minio },
  };
}
