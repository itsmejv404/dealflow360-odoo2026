from typing import Any, Optional, Set
import socketio
from src.config.env import settings
from src.lib.logger import logger
from src.shared.jwt_utils import verify_jwt

sio = socketio.AsyncServer(
    async_mode="asgi",
    cors_allowed_origins=settings.cors_origins or "*",
)

@sio.event
async def connect(sid: str, environ: dict, auth: Optional[dict] = None):
    token = None
    if auth and isinstance(auth, dict) and auth.get("token"):
        token = auth["token"]
    elif "HTTP_AUTHORIZATION" in environ and environ["HTTP_AUTHORIZATION"].startswith("Bearer "):
        token = environ["HTTP_AUTHORIZATION"][7:]

    if not token:
        logger.warning(f"Socket connection rejected (sid: {sid}): Missing auth token")
        return False

    try:
        payload = verify_jwt(token)
    except Exception as e:
        logger.warning(f"Socket connection rejected (sid: {sid}): {e}")
        return False

    org_id = payload.get("org_id")
    if not org_id:
        return False

    typ = payload.get("typ")
    role = payload.get("role")
    if typ == "super_admin" or role == "super_admin":
        return False

    if typ == "customer" and role:
        return False

    is_internal = typ == "internal" or (typ is None and role is not None)
    quotation_ids = payload.get("quotation_ids", []) if not is_internal else []

    await sio.save_session(sid, {
        "user_id": payload.get("sub"),
        "org_id": org_id,
        "role": role,
        "is_internal": is_internal,
        "quotation_ids": quotation_ids,
    })

    if is_internal:
        await sio.enter_room(sid, f"org:{org_id}")
        logger.info(f"Internal socket {sid} joined org:{org_id}")
    else:
        for qid in quotation_ids:
            await sio.enter_room(sid, f"org:{org_id}:quote:{qid}")
        logger.info(f"Customer socket {sid} joined {len(quotation_ids)} quote rooms")

    return True

@sio.event
async def disconnect(sid: str):
    logger.debug(f"Socket disconnected {sid}")

@sio.on("quote:join")
async def on_quote_join(sid: str, quotation_id: str):
    session = await sio.get_session(sid)
    if not session:
        return
    org_id = session.get("org_id")
    if not org_id or not isinstance(quotation_id, str):
        return

    quotation_id = quotation_id.strip()
    if not quotation_id:
        return

    if session.get("is_internal"):
        await sio.enter_room(sid, f"org:{org_id}:quote:{quotation_id}")
    else:
        allowed = set(session.get("quotation_ids", []))
        if quotation_id in allowed:
            await sio.enter_room(sid, f"org:{org_id}:quote:{quotation_id}")

@sio.on("quote:leave")
async def on_quote_leave(sid: str, quotation_id: str):
    session = await sio.get_session(sid)
    if not session:
        return
    org_id = session.get("org_id")
    if org_id and isinstance(quotation_id, str):
        await sio.leave_room(sid, f"org:{org_id}:quote:{quotation_id.strip()}")

async def emit_to_org(org_id: str, event: str, data: Any):
    try:
        await sio.emit(event, data, room=f"org:{org_id}")
    except Exception as e:
        logger.warning(f"Failed to emit to org:{org_id} event {event}: {e}")

async def emit_to_quote(org_id: str, quotation_id: str, event: str, data: Any):
    try:
        await sio.emit(event, data, room=f"org:{org_id}:quote:{quotation_id}")
    except Exception as e:
        logger.warning(f"Failed to emit to quote room {quotation_id}: {e}")
