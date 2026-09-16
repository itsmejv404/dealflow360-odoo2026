from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException
import socketio

from src.config.env import settings
from src.lib.logger import logger
from src.lib.socket import sio
from src.shared.errors import (
    HttpError, http_error_handler,
    starlette_http_error_handler, validation_error_handler
)
from src.routers import (
    health_router, auth_router, users_router, organization_router,
    onboarding_router, platform_router, catalog_router, rulebook_router,
    quotations_router, approvals_router, negotiation_router, warehouses_router,
    fulfillment_router, billing_router, dealhealth_router, files_router,
    portal_router, recommendations_router, governance_router, demo_router
)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("DealFlow360 FastAPI Backend starting up...")
    yield
    logger.info("DealFlow360 FastAPI Backend shutting down...")

app = FastAPI(
    title="DealFlow360 API",
    description="Multi-Tenant Quote-to-Cash Platform FastAPI Backend with RabbitMQ",
    version="1.0.0",
    lifespan=lifespan,
)

# Exception handlers
app.add_exception_handler(HttpError, http_error_handler)
app.add_exception_handler(StarletteHTTPException, starlette_http_error_handler)
app.add_exception_handler(RequestValidationError, validation_error_handler)

# CORS Middleware
origins = settings.cors_origins
if not origins:
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all 20 module routers
app.include_router(health_router)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(organization_router)
app.include_router(onboarding_router)
app.include_router(platform_router)
app.include_router(catalog_router)
app.include_router(rulebook_router)
app.include_router(quotations_router)
app.include_router(approvals_router)
app.include_router(negotiation_router)
app.include_router(warehouses_router)
app.include_router(fulfillment_router)
app.include_router(billing_router)
app.include_router(dealhealth_router)
app.include_router(files_router)
app.include_router(portal_router)
app.include_router(recommendations_router)
app.include_router(governance_router)
app.include_router(demo_router)

# Mount python-socketio ASGI application wrapping FastAPI
asgi_app = socketio.ASGIApp(
    sio,
    other_asgi_app=app,
    socketio_path="socket.io"
)
