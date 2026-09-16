from src.routers.health import router as health_router
from src.routers.auth import router as auth_router
from src.routers.users import router as users_router
from src.routers.organization import router as organization_router
from src.routers.onboarding import router as onboarding_router
from src.routers.platform import router as platform_router
from src.routers.catalog import router as catalog_router
from src.routers.rulebook import router as rulebook_router
from src.routers.quotations import router as quotations_router
from src.routers.approvals import router as approvals_router
from src.routers.negotiation import router as negotiation_router
from src.routers.warehouses import router as warehouses_router
from src.routers.fulfillment import router as fulfillment_router
from src.routers.billing import router as billing_router
from src.routers.dealhealth import router as dealhealth_router
from src.routers.files import router as files_router
from src.routers.portal import router as portal_router
from src.routers.recommendations import router as recommendations_router
from src.routers.governance import router as governance_router
from src.routers.demo import router as demo_router

__all__ = [
    "health_router", "auth_router", "users_router", "organization_router",
    "onboarding_router", "platform_router", "catalog_router", "rulebook_router",
    "quotations_router", "approvals_router", "negotiation_router", "warehouses_router",
    "fulfillment_router", "billing_router", "dealhealth_router", "files_router",
    "portal_router", "recommendations_router", "governance_router", "demo_router"
]
