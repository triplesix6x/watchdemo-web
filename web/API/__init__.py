from fastapi import APIRouter

from API.views.auth.views import router as auth_router
from API.views.social.views import router as social_router
from API.views.legal.views import router as legal_router
from API.views.user.views import router as user_router
from API.views.admin.views import router as admin_router
from API.views.app.views import router as app_router
from API.views.crash.views import router as crash_router
from API.views.support.views import customer_router, staff_router
from API.views.maintenance.views import public_router as maintenance_public_router, admin_router as maintenance_admin_router

router = APIRouter(prefix="/api/v1")
router.include_router(auth_router)
router.include_router(social_router)
router.include_router(legal_router)
router.include_router(user_router)
router.include_router(admin_router)
router.include_router(app_router)
router.include_router(crash_router)
router.include_router(customer_router)
router.include_router(staff_router)
router.include_router(maintenance_public_router)
router.include_router(maintenance_admin_router)
