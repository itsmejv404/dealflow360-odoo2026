from redis.asyncio import Redis
from src.config.env import settings

_redis_client: Redis | None = None

def get_redis() -> Redis:
    global _redis_client
    if _redis_client is None:
        _redis_client = Redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client
