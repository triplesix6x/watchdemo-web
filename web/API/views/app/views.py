from fastapi import APIRouter, Path, Response, status

from API.views.app.schemas import UpdateManifest
from APP.dependencies import AnnReleaseService, OptionalUser

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
        notes=release.notes,
    )
