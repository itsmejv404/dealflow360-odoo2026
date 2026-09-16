from datetime import timedelta
import io
from typing import Optional, Tuple
from minio import Minio
from src.config.env import settings
from src.lib.logger import logger

class StorageService:
    def __init__(self):
        endpoint = f"{settings.MINIO_ENDPOINT}:{settings.MINIO_PORT}"
        self.client = Minio(
            endpoint=endpoint,
            access_key=settings.MINIO_ROOT_USER,
            secret_key=settings.MINIO_ROOT_PASSWORD,
            secure=settings.MINIO_USE_SSL,
        )
        self.bucket_name = settings.MINIO_BUCKET
        self._ensure_bucket()

    def _ensure_bucket(self):
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
        except Exception as e:
            logger.warning(f"MinIO bucket check/create failed: {e}")

    def get_tenant_object_key(self, org_id: str, key: str) -> str:
        clean_key = key.lstrip("/")
        return f"org-{org_id}/{clean_key}"

    def upload_tenant_file(
        self, org_id: str, key: str, data: bytes, content_type: str
    ) -> str:
        full_path = self.get_tenant_object_key(org_id, key)
        self.client.put_object(
            bucket_name=self.bucket_name,
            object_name=full_path,
            data=io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )
        logger.info(f"Uploaded tenant file {full_path} ({content_type})")
        return full_path

    def get_tenant_file(self, org_id: str, key: str) -> Tuple[bytes, str]:
        full_path = self.get_tenant_object_key(org_id, key)
        response = self.client.get_object(self.bucket_name, full_path)
        try:
            content = response.read()
            content_type = response.headers.get("content-type", "application/octet-stream")
            return content, content_type
        finally:
            response.close()
            response.release_conn()

    def get_tenant_signed_url(self, org_id: str, key: str, expires_in: int = 3600) -> str:
        full_path = self.get_tenant_object_key(org_id, key)
        return self.client.presigned_get_object(
            self.bucket_name, full_path, expires=timedelta(seconds=expires_in)
        )

    def delete_tenant_file(self, org_id: str, key: str) -> None:
        full_path = self.get_tenant_object_key(org_id, key)
        self.client.remove_object(self.bucket_name, full_path)

storage_service = StorageService()
