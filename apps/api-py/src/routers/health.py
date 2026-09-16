import time
from datetime import datetime
from fastapi import APIRouter, Response, status, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from src.database import get_db
from src.lib.redis import get_redis
from src.lib.minio_client import storage_service
from src.lib.celery_app import celery_app

router = APIRouter(prefix="/api/health", tags=["Health"])

_start_time = time.time()

async def probe(fn):
    start = time.perf_counter()
    try:
        await fn()
        return {"status": "up", "latencyMs": round((time.perf_counter() - start) * 1000)}
    except Exception as e:
        return {"status": "down", "latencyMs": round((time.perf_counter() - start) * 1000), "detail": str(e)}

@router.get("")
@router.get("/")
async def get_health(response: Response, db: AsyncSession = Depends(get_db)):
    async def check_pg():
        await db.execute(text("SELECT 1"))

    async def check_redis():
        r = get_redis()
        await r.ping()

    async def check_minio():
        storage_service.client.list_buckets()

    async def check_bucket():
        storage_service.client.bucket_exists(storage_service.bucket_name)

    async def check_rabbitmq():
        # verify connection to broker
        with celery_app.connection_for_read() as conn:
            conn.connect()

    postgres_check = await probe(check_pg)
    redis_check = await probe(check_redis)
    minio_check = await probe(check_minio)
    bucket_check = await probe(check_bucket)
    rabbitmq_check = await probe(check_rabbitmq)

    all_up = all(s["status"] == "up" for s in [postgres_check, redis_check, minio_check, bucket_check])

    if not all_up:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE

    return {
        "status": "ok" if all_up else "degraded",
        "uptime": round(time.time() - _start_time, 1),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "services": {
            "postgres": postgres_check,
            "redis": redis_check,
            "minio": minio_check,
            "storageBucket": bucket_check,
            "rabbitmq": rabbitmq_check,
        }
    }
