import os
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    NODE_ENV: str = "development"
    API_PORT: int = 8000
    DATABASE_URL: str = "postgresql+asyncpg://dealflow:dealflow@postgres:5432/dealflow"
    DATABASE_SYNC_URL: str = "postgresql://dealflow:dealflow@postgres:5432/dealflow"
    REDIS_URL: str = "redis://redis:6379/0"
    RABBITMQ_URL: str = "amqp://guest:guest@rabbitmq:5672//"
    
    MINIO_ENDPOINT: str = "minio"
    MINIO_PORT: int = 9000
    MINIO_USE_SSL: bool = False
    MINIO_ROOT_USER: str = "minioadmin"
    MINIO_ROOT_PASSWORD: str = "minioadmin"
    MINIO_BUCKET: str = "dealflow"
    
    SMTP_HOST: str = "mailhog"
    SMTP_PORT: int = 1025
    GOTENBERG_URL: str = "http://gotenberg:3000"
    JWT_SECRET: str = "dealflow360-super-secret-key-for-dev-only"
    SOCKET_CORS_ORIGINS: str = "http://localhost,http://localhost:5173,http://localhost:5174"
    PORTAL_URL: str = "http://localhost"

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.SOCKET_CORS_ORIGINS.split(",") if o.strip()]

settings = Settings()
