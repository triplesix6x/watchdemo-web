from fastapi import APIRouter

from API.views.auth.views import router as auth_router
from API.views.user.views import router as user_router
from API.views.admin.views import router as admin_router

router = APIRouter(prefix="/api/v1")
router.include_router(auth_router)
router.include_router(user_router)
router.include_router(admin_router)
