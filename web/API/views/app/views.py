from fastapi import APIRouter, Path, Query, Response, status

from API.views.app.schemas import ChangelogEntry, LatestRelease, TiersResponse, UpdateManifest
from APP.constants import ReleaseChannel
from APP.dependencies import AnnReleaseService, OptionalUser
from APP.exceptions import ErrorCode, NotFoundError
from APP.tiers import tier_matrix

router = APIRouter(prefix="/app", tags=["app"])


@router.get(
    "/update/{target}/{arch}/{current_version}",
    response_model=UpdateManifest,
    responses={204: {"description": "Установлена актуальная версия"}},
)
async def check_update(
    service: AnnReleaseService,
    user: OptionalUser,
    target: str = Path(max_length=32),
    arch: str = Path(max_length=32),
    current_version: str = Path(max_length=64),
):
    """Проверка обновления для десктопного клиента.

    URL дёргает `tauri-plugin-updater`, подставляя свои плейсхолдеры
    `{{target}}`, `{{arch}}` и `{{current_version}}`. Авторизация
    опциональна: проверка идёт до входа в аккаунт, а токен нужен только
    чтобы понять, показывать ли бета-канал. `204` означает «обновлений нет»
    и является для клиента штатным ответом.
    """
    release = await service.check_update(
        current_version=current_version,
        target=target,
        arch=arch,
        is_beta_tester=bool(user and user.is_beta_tester),
    )
    if not release:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    return UpdateManifest(
        version=release.version,
        pub_date=release.published_at,
        url=service.public_url(release),
        signature=release.signature,
    )


@router.get("/latest", response_model=LatestRelease)
async def latest_release(
    service: AnnReleaseService,
    user: OptionalUser,
    target: str = Query("windows", max_length=32),
    arch: str = Query("x86_64", max_length=32),
):
    """Актуальная сборка для кнопки «Скачать». Бета-тестеру отдаём и бету."""
    release = await service.latest_for(
        target=target, arch=arch, is_beta_tester=bool(user and user.is_beta_tester)
    )
    if not release:
        raise NotFoundError("No release available", code=ErrorCode.RELEASE_NOT_FOUND)
    return LatestRelease(
        version=release.version,
        channel=release.channel,
        url=service.public_url(release),
        file_name=release.file_name,
        file_size=release.file_size,
        sha256=release.sha256,
        published_at=release.published_at,
        # Заметки скрытого из changelog релиза внутренние, наружу не отдаём.
        notes=release.notes if release.show_in_changelog else None,
    )


@router.get("/releases", response_model=list[ChangelogEntry])
async def changelog(
    service: AnnReleaseService,
    channel: ReleaseChannel = ReleaseChannel.STABLE,
    limit: int = Query(20, ge=1, le=100),
    target: str = Query("windows", max_length=32),
    arch: str = Query("x86_64", max_length=32),
):
    """Публичный «Что нового»: только релизы с флагом `show_in_changelog`."""
    releases = await service.changelog(channel, target, arch, limit)
    return [
        ChangelogEntry(
            version=r.version,
            channel=r.channel,
            published_at=r.published_at,
            notes=r.notes,
        )
        for r in releases
    ]


@router.get("/tiers", response_model=TiersResponse)
async def tiers():
    """Матрица тарифов для страницы цен (зеркало `core/access.rs` приложения)."""
    return TiersResponse(tiers=tier_matrix())
