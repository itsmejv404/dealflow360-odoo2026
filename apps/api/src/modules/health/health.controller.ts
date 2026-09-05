import type { Request, Response } from 'express';
import { getHealth } from './health.service.js';

export async function healthController(_req: Request, res: Response): Promise<void> {
  const report = await getHealth();
  res.status(report.status === 'ok' ? 200 : 503).json(report);
}
