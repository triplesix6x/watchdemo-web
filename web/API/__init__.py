from fastapi import APIRouter

from API.views.auth.views import router as auth_router
from API.views.user.views import router as user_router
from API.views.admin.views import router as admin_router
from API.views.app.views import router as app_router
from API.views.support.views import customer_router, staff_router, telegram_router

router = APIRouter(prefix="/api/v1")
router.include_router(auth_router)
router.include_router(user_router)
router.include_router(admin_router)
router.include_router(app_router)
router.include_router(customer_router)
router.include_router(staff_router)
router.include_router(telegram_router)
