from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
import jwt
import bcrypt
from src.config.env import settings
from src.shared.errors import HttpError

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(10)
    return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

def verify_password(plain_password: str, hashed_password: str) -> bool:
    try:
        return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
    except Exception:
        return False

def sign_internal_token(payload: Dict[str, Any], expires_in_seconds: int = 86400) -> str:
    data = dict(payload)
    data["typ"] = "internal"
    data["exp"] = datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)
    data["iat"] = datetime.now(timezone.utc)
    return jwt.encode(data, settings.JWT_SECRET, algorithm="HS256")

def sign_super_admin_token(payload: Dict[str, Any], expires_in_seconds: int = 86400) -> str:
    data = dict(payload)
    data["typ"] = "super_admin"
    data["role"] = "super_admin"
    data["exp"] = datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)
    data["iat"] = datetime.now(timezone.utc)
    return jwt.encode(data, settings.JWT_SECRET, algorithm="HS256")

def sign_customer_token(payload: Dict[str, Any], expires_in_seconds: int = 7 * 86400) -> str:
    data = dict(payload)
    data["typ"] = "customer"
    data["exp"] = datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds)
    data["iat"] = datetime.now(timezone.utc)
    return jwt.encode(data, settings.JWT_SECRET, algorithm="HS256")

def verify_jwt(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.ExpiredSignatureError:
        raise HttpError(401, "Invalid or expired authentication token")
    except Exception:
        raise HttpError(401, "Invalid or expired authentication token")
