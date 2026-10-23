import uuid
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile

from API.views.admin.schemas import (
    AuditItem,
    AuditPage,
    ExpiringItem,
    ExtendSubscriptionRequest,
    ReleaseItem,
    ReleasesPage,
    GrantRoleRequest,
    GrantRoleResponse,
    GrantSubscriptionRequest,
    GrantSubscriptionResponse,
    RevokeSubscriptionRequest,
    SessionItem,
    SetActiveRequest,
    SetBetaRequest,
    SetReleaseActiveRequest,
    SignupPoint,
    StatsResponse,
    SubscriptionSummary,
    TierSplit,
    TimeseriesResponse,
    UpdateReleaseRequest,
    UserDetailResponse,
    UserListItem,
    UsersPage,
)
from APP.constants import ReleaseChannel, SubscriptionTier, UserRole
from APP.entities.admin import AuditLogView, UserDetail, UserFilters
from APP.entities.release import ReleaseEntity
from APP.entities.session import SessionEntity
from APP.entities.subscription import SubscriptionEntity
from APP.entities.user import UserEntity
from APP.dependencies import (
    AnnAdminService,
    AnnAuthService,
    Audit,
    AnnReleaseService,
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
        is_beta_tester=user.is_beta_tester,
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
        is_beta_tester=user.is_beta_tester,
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


@router.get("/stats/timeseries", response_model=TimeseriesResponse)
async def get_timeseries(
    service: AnnAdminService,
    days: int = Query(30, ge=1, le=90),
    auth: AuthContext = Depends(_require_support),
):
    data = await service.get_timeseries(days)
    return TimeseriesResponse(
        signups=[SignupPoint(date=d, count=n) for d, n in data.signups],
        tiers=TierSplit(**data.tiers),
        expiring_soon=[
            ExpiringItem(
                user_id=e.user_id,
                username=e.username,
                tier=e.tier,
                expires_at=e.expires_at,
            )
            for e in data.expiring_soon
        ],
    )


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
    service: AnnAdminService,
    audit: Audit,
    auth: AuthContext = Depends(_require_moderator),
):
    user = await service.set_active(auth.user, user_id, body.is_active)
    await audit(
        "activate_user" if body.is_active else "deactivate_user",
        target_user_id=user.id,
        details={"is_active": body.is_active},
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
    service: AnnSubscriptionService,
    audit: Audit,
    auth: AuthContext = Depends(_require_moderator),
):
    sub = await service.grant(
        auth.user,
        user_id=body.user_id,
        username=body.username,
        tier=body.tier,
        expires_at=body.expires_at,
    )
    await audit(
        "grant_subscription",
        target_user_id=sub.user_id,
        details={
            "tier": str(sub.tier),
            "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        },
    )
    return _subscription_response(sub)


def _subscription_response(sub: SubscriptionEntity) -> GrantSubscriptionResponse:
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


@router.post("/subscriptions/extend", response_model=GrantSubscriptionResponse)
async def extend_subscription(
    body: ExtendSubscriptionRequest,
    service: AnnSubscriptionService,
    audit: Audit,
    auth: AuthContext = Depends(_require_moderator),
):
    sub = await service.extend(auth.user, body.user_id, body.days)
    await audit(
        "extend_subscription",
        target_user_id=sub.user_id,
        details={
            "days": body.days,
            "tier": str(sub.tier),
            "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
        },
    )
    return _subscription_response(sub)


@router.post("/subscriptions/revoke", response_model=GrantSubscriptionResponse)
async def revoke_subscription(
    body: RevokeSubscriptionRequest,
    service: AnnSubscriptionService,
    audit: Audit,
    auth: AuthContext = Depends(_require_moderator),
):
    sub, previous = await service.revoke(auth.user, body.user_id)
    await audit(
        "revoke_subscription",
        target_user_id=sub.user_id,
        details={"previous_tier": str(previous) if previous else None},
    )
    return _subscription_response(sub)


@router.post("/users/role", response_model=GrantRoleResponse)
async def grant_role(
    body: GrantRoleRequest,
    service: AnnUserService,
    audit: Audit,
    auth: AuthContext = Depends(_require_admin),
):
    user = await service.update_role(
        user_id=body.user_id,
        username=body.username,
        role=body.role,
    )
    await audit(
        "grant_role",
        target_user_id=user.id,
        details={"role": str(body.role)},
    )
    return GrantRoleResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=UserRole(user.role),
    )


@router.patch("/users/{user_id}/beta", response_model=UserListItem)
async def set_user_beta(
    user_id: uuid.UUID,
    body: SetBetaRequest,
    service: AnnAdminService,
    audit: Audit,
    auth: AuthContext = Depends(_require_moderator),
):
    """Открывает или закрывает пользователю бета-канал обновлений."""
    user = await service.set_beta_tester(auth.user, user_id, body.is_beta_tester)
    await audit(
        "grant_beta" if body.is_beta_tester else "revoke_beta",
        target_user_id=user.id,
        details={"is_beta_tester": body.is_beta_tester},
    )
    return _user_list_item(user)


@router.delete("/users/{user_id}/sessions", status_code=204)
async def revoke_user_sessions(
    user_id: uuid.UUID,
    service: AnnAdminService,
    audit: Audit,
    auth: AuthContext = Depends(_require_moderator),
):
    """Завершает все сеансы пользователя: токены перестают работать сразу."""
    count = await service.revoke_sessions(auth.user, user_id)
    await audit(
        "revoke_sessions",
        target_user_id=user_id,
        details={"count": count},
    )


@router.post("/users/{user_id}/password-reset", status_code=202)
async def send_password_reset(
    user_id: uuid.UUID,
    service: AnnAdminService,
    auth_service: AnnAuthService,
    audit: Audit,
    auth: AuthContext = Depends(_require_moderator),
):
    """Шлёт пользователю письмо со ссылкой сброса пароля."""
    target = await service.get_password_reset_target(auth.user, user_id)
    await auth_service.send_password_reset(target)
    await audit(
        "send_password_reset",
        target_user_id=user_id,
    )
    return {"message": "Password reset email sent"}


@router.post("/users/{user_id}/verify", response_model=UserListItem)
async def verify_user(
    user_id: uuid.UUID,
    service: AnnAdminService,
    audit: Audit,
    auth: AuthContext = Depends(_require_moderator),
):
    """Подтверждает почту пользователя вручную."""
    user = await service.verify_user(auth.user, user_id)
    await audit(
        "verify_user",
        target_user_id=user.id,
    )
    return _user_list_item(user)


def _release_item(release: ReleaseEntity, url: str) -> ReleaseItem:
    """Преобразует релиз в элемент ответа админки."""
    return ReleaseItem(
        id=release.id,
        version=release.version,
        channel=ReleaseChannel(release.channel),
        target=release.target,
        arch=release.arch,
        file_name=release.file_name,
        file_size=release.file_size,
        sha256=release.sha256,
        notes=release.notes,
        show_in_changelog=release.show_in_changelog,
        is_active=bool(release.is_active),
        published_at=release.published_at,
        published_by=release.published_by,
        url=url,
    )


@router.post("/releases", response_model=ReleaseItem, status_code=201)
async def publish_release(
    service: AnnReleaseService,
    audit: Audit,
    installer: UploadFile = File(..., description="Инсталлятор из bundle/nsis"),
    version: str = Form(..., max_length=64),
    channel: ReleaseChannel = Form(ReleaseChannel.STABLE),
    target: str = Form("windows", max_length=32),
    arch: str = Form("x86_64", max_length=32),
    notes: str | None = Form(None),
    signature: str | None = Form(None, description="Содержимое .sig"),
    signature_file: UploadFile | None = File(None, description="Файл .sig"),
    auth: AuthContext = Depends(_require_admin),
):
    """Публикует сборку десктопного приложения.

    Подпись принимается либо строкой, либо файлом `.sig` — скрипт релиза
    удобнее шлёт файл, руками проще вставить строку.
    """
    sig = signature or ""
    if signature_file is not None:
        sig = (await signature_file.read()).decode("utf-8", errors="replace")

    release = await service.publish(
        version=version,
        channel=channel,
        target=target,
        arch=arch,
        installer=installer,
        signature=sig,
        notes=notes,
        published_by=auth.user.id,
    )
    await audit(
        "publish_release",
        details={
            "version": release.version,
            "channel": str(release.channel),
            "target": release.target,
            "arch": release.arch,
            "sha256": release.sha256,
        },
    )
    return _release_item(release, service.public_url(release))


@router.get("/releases", response_model=ReleasesPage)
async def list_releases(
    service: AnnReleaseService,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=100),
    channel: ReleaseChannel | None = None,
    auth: AuthContext = Depends(_require_moderator),
):
    items, total = await service.list_releases(page, page_size, channel)
    return ReleasesPage(
        items=[_release_item(r, service.public_url(r)) for r in items],
        total=total,
        page=page,
        page_size=page_size,
    )


@router.patch("/releases/{release_id}/active", response_model=ReleaseItem)
async def set_release_active(
    release_id: uuid.UUID,
    body: SetReleaseActiveRequest,
    service: AnnReleaseService,
    audit: Audit,
    auth: AuthContext = Depends(_require_admin),
):
    """Аварийный рубильник: гасит или возвращает релиз в выдачу."""
    release = await service.set_active(release_id, body.is_active)
    await audit(
        "activate_release" if body.is_active else "deactivate_release",
        details={"version": release.version, "is_active": body.is_active},
    )
    return _release_item(release, service.public_url(release))


@router.patch("/releases/{release_id}", response_model=ReleaseItem)
async def update_release(
    release_id: uuid.UUID,
    body: UpdateReleaseRequest,
    service: AnnReleaseService,
    audit: Audit,
    auth: AuthContext = Depends(_require_admin),
):
    """Правит заметки релиза и его видимость в публичном changelog."""
    changes = body.model_dump(exclude_unset=True)
    release = await service.update(release_id, changes)
    await audit(
        "update_release",
        details={"version": release.version, "fields": sorted(changes)},
    )
    return _release_item(release, service.public_url(release))
