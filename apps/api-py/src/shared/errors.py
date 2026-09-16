from fastapi import Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

class HttpError(Exception):
    def __init__(self, status_code: int, message: str):
        self.status_code = status_code
        self.message = message
        super().__init__(message)

async def http_error_handler(_req: Request, exc: HttpError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": exc.message}
    )

async def starlette_http_error_handler(_req: Request, exc: StarletteHTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": str(exc.detail)}
    )

async def validation_error_handler(_req: Request, exc: RequestValidationError) -> JSONResponse:
    # Build user friendly message matching friendlyZodMessage
    msg = "Some values are missing or invalid — please review your input and try again."
    errors = exc.errors()
    if errors:
        first = errors[0]
        custom_msg = first.get("msg")
        if custom_msg and not custom_msg.startswith("value is not a valid"):
            msg = custom_msg
    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={"error": msg}
    )
