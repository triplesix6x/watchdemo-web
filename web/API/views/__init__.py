from API.views.auth.views import router as auth_router
from API.views.user.views import router as user_router
from API.views.admin.views import router as admin_router

__all__ = ["auth_router", "user_router", "admin_router"]
