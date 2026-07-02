import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Query, Request

from API.views.admin.schemas import (
    AuditItem,
    AuditPage,
    GrantRoleRequest,
    GrantRoleResponse,
    GrantSubscriptionRequest,
    GrantSubscriptionResponse,
    SessionItem,
    SetActiveRequest,
    StatsResponse,
    SubscriptionSummary,
    UserDetailResponse,
    UserListItem,
    UsersPage,
)
from APP.constants import SubscriptionTier, UserRole
from APP.entities.admin import AuditLogView, UserDetail, UserFilters
from APP.entities.session import SessionEntity
from APP.entities.subscription import SubscriptionEntity
from APP.entities.user import UserEntity
from APP.dependencies import (
    AnnAdminService,
    AnnAuditLogRepo,
    AnnSubscriptionService,
    AnnUserService,
    AuthContext,
    require_role,
)

router = APIRouter(prefix="/admin", tags=["admin"])

_require_admin = require_role(UserRole.ADMIN)
_require_moderator = require_role(UserRole.MODERATOR)
_require_support = require_role(UserRole.SUPPORT)


def _sub_summary(sub: SubscriptionEntity | None) -> SubscriptionSummary | None:
    """Собирает краткую сводку по подписке для списка/карточки."""
    if not sub:
        return None
    return SubscriptionSummary(
        tier=sub.tier,
        effective_tier=sub.effective_tier,
        expires_at=sub.expires_at,
        is_expired=sub.is_expired,
    )


def _user_list_item(user: UserEntity) -> UserListItem:
    """Преобразует пользователя в строку списка админки."""
    return UserListItem(
        id=user.id,
        email=user.email,
        username=user.username,
        role=UserRole(user.role),
        is_verified=user.is_verified,
        is_active=bool(user.is_active),
        created_at=user.created_at,
        subscription=_sub_summary(user.subscription),
    )


def _session_item(session: SessionEntity) -> SessionItem:
    """Преобразует активную сессию в элемент карточки пользователя."""
    return SessionItem(
        id=session.id,
        device_info=session.device_info,
        ip_address=session.ip_address,
        expires_at=session.expires_at,
        last_used_at=session.last_used_at,
        created_at=session.created_at,
    )


def _audit_item(view: AuditLogView) -> AuditItem:
    """Преобразует запись аудита в элемент ответа."""
    return AuditItem(
        id=view.id,
        actor_id=view.actor_id,
        actor_username=view.actor_username,
        action=view.action,
        target_user_id=view.target_user_id,
        target_username=view.target_username,
        details=view.details,
        ip_address=view.ip_address,
        created_at=view.created_at,
    )


def _user_detail_response(detail: UserDetail) -> UserDetailResponse:
    """Собирает ответ карточки пользователя из доменного объекта."""
    user = detail.user
    return UserDetailResponse(
        id=user.id,
        email=user.email,
        username=user.username,
        role=UserRole(user.role),
        is_verified=user.is_verified,
        is_active=bool(user.is_active),
        created_at=user.created_at,
        subscription=_sub_summary(user.subscription),
        sessions=[_session_item(s) for s in detail.sessions],
        audit=[_audit_item(a) for a in detail.audit],
    )


@router.get("/users", response_model=UsersPage)
async def list_users(
    service: AnnAdminService,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    q: str | None = Query(None, max_length=255),
    role: UserRole | None = None,
    verified: bool | None = None,
    active: bool | None = None,
    tier: Literal["none", "basic", "plus", "pro"] | None = None,
    auth: AuthContext = Depends(_require_support),
):
    filters = UserFilters(
        q=q,
        role=role,
        is_verified=verified,
        is_active=active,
        tier=SubscriptionTier(tier) if tier and tier != "none" else None,
        tier_none=tier == "none",
    )
    items, total = await service.list_users(filters, page, page_size)
    return UsersPage(
        items=[_user_list_item(u) for u in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/stats", response_model=StatsResponse)
async def get_stats(
    service: AnnAdminService,
    auth: AuthContext = Depends(_require_support),
):
    stats = await service.get_stats()
    return StatsResponse(**vars(stats))


@router.get("/users/{user_id}", response_model=UserDetailResponse)
async def get_user_detail(
    user_id: uuid.UUID,
    service: AnnAdminService,
    auth: AuthContext = Depends(_require_support),
):
    include_audit = UserRole(auth.user.role) is UserRole.ADMIN
    detail = await service.get_user_detail(user_id, include_audit=include_audit)
    return _user_detail_response(detail)


@router.patch("/users/{user_id}/active", response_model=UserListItem)
async def set_user_active(
    user_id: uuid.UUID,
    body: SetActiveRequest,
    request: Request,
    service: AnnAdminService,
    audit: AnnAuditLogRepo,
    auth: AuthContext = Depends(_require_moderator),
):
    user = await service.set_active(auth.user, user_id, body.is_active)
    await audit.log(
        actor_id=auth.user.id,
        action="activate_user" if body.is_active else "deactivate_user",
        target_user_id=user.id,
        details={"is_active": body.is_active},
        ip_address=request.client.host if request.client else None,
    )
    return _user_list_item(user)


@router.get("/audit", response_model=AuditPage)
async def list_audit(
    service: AnnAdminService,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    auth: AuthContext = Depends(_require_admin),
):
    items, total = await service.list_audit(page, page_size)
    return AuditPage(
        items=[_audit_item(a) for a in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.post("/subscriptions/grant", response_model=GrantSubscriptionResponse)
async def grant_subscription(
    body: GrantSubscriptionRequest,
    request: Request,
    service: AnnSubscriptionService,
    audit: AnnAuditLogRepo,
    auth: AuthContext = Depends(_require_moderator),
):
    sub = await service.grant(
        user_id=body.user_id,
        username=body.username,
        tier=body.tier,
        expires_at=body.expires_at,
        granted_by=auth.user.id,
    )
    await audit.log(
        actor_id=auth.user.id,
        action="grant_subscription",
        target_user_id=sub.user_id,
        details={
            "tier": str(sub.tier),
            "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        },
        ip_address=request.client.host if request.client else None,
    )
    return GrantSubscriptionResponse(
        id=sub.id,
        user_id=sub.user_id,
        tier=sub.tier,
        effective_tier=sub.effective_tier,
        started_at=sub.started_at,
        expires_at=sub.expires_at,
        granted_by=sub.granted_by,
        is_expired=sub.is_expired,
    )


@router.post("/users/role", response_model=GrantRoleResponse)
async def grant_role(
    body: GrantRoleRequest,
    request: Request,
    service: AnnUserService,
    audit: AnnAuditLogRepo,
    auth: AuthContext = Depends(_require_admin),
):
    user = await service.update_role(
        user_id=body.user_id,
        username=body.username,
        role=body.role,
    )
    await audit.log(
        actor_id=auth.user.id,
        action="grant_role",
        target_user_id=user.id,
        details={"role": str(body.role)},
        ip_address=request.client.host if request.client else None,
    )
    return GrantRoleResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=UserRole(user.role),
    )
