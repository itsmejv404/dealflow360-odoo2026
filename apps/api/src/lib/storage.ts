import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { s3 } from './minio.js';
import { env } from '../config/env.js';
import { logger } from './logger.js';

export interface UploadTenantFileOptions {
  orgId: string;
  key: string;
  buffer: Buffer;
  contentType: string;
}

export class StorageService {
  private getBucketName(): string {
    return env.MINIO_BUCKET;
  }

  getTenantObjectKey(orgId: string, key: string): string {
    // Strip leading slashes and enforce org-{id}/ prefix
    const cleanKey = key.replace(/^\/+/, '');
    return `org-${orgId}/${cleanKey}`;
  }

  async uploadTenantFile({
    orgId,
    key,
    buffer,
    contentType,
  }: UploadTenantFileOptions): Promise<{ key: string; fullPath: string }> {
    const fullPath = this.getTenantObjectKey(orgId, key);

    const command = new PutObjectCommand({
      Bucket: this.getBucketName(),
      Key: fullPath,
      Body: buffer,
      ContentType: contentType,
    });

    await s3.send(command);
    logger.info({ orgId, fullPath, contentType }, 'Uploaded tenant file to MinIO');

    return { key, fullPath };
  }

  async getTenantFileStream(orgId: string, key: string) {
    const fullPath = this.getTenantObjectKey(orgId, key);

    const command = new GetObjectCommand({
      Bucket: this.getBucketName(),
      Key: fullPath,
    });

    const response = await s3.send(command);
    return {
      body: response.Body,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
    };
  }

  async getTenantSignedUrl(orgId: string, key: string, expiresIn = 3600): Promise<string> {
    const fullPath = this.getTenantObjectKey(orgId, key);

    const command = new GetObjectCommand({
      Bucket: this.getBucketName(),
      Key: fullPath,
    });

    return getSignedUrl(s3, command, { expiresIn });
  }

  async deleteTenantFile(orgId: string, key: string): Promise<void> {
    const fullPath = this.getTenantObjectKey(orgId, key);

    const command = new DeleteObjectCommand({
      Bucket: this.getBucketName(),
      Key: fullPath,
    });

    await s3.send(command);
    logger.info({ orgId, fullPath }, 'Deleted tenant file from MinIO');
  }
}

export const storageService = new StorageService();
