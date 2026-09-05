import { S3Client } from '@aws-sdk/client-s3';
import { env } from '../config/env.js';

export const s3 = new S3Client({
  endpoint: `${env.MINIO_USE_SSL ? 'https' : 'http'}://${env.MINIO_ENDPOINT}:${env.MINIO_PORT}`,
  region: 'us-east-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.MINIO_ROOT_USER,
    secretAccessKey: env.MINIO_ROOT_PASSWORD,
  },
});
