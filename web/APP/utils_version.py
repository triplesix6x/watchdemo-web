"""Сравнение версий приложения по правилам semver.

Отдельный модуль, чтобы не тащить зависимость: нам нужен ровно один
предикат «новее ли». Формат — `MAJOR.MINOR.PATCH[-prerelease][+build]`,
как его пишет Cargo и как его читает клиентский `tauri-plugin-updater`
(он внутри сравнивает тем же semver, поэтому расхождение логики сервера
и клиента приводило бы к бесконечному циклу обновления).
"""

import re

_SEMVER = re.compile(
    r"^(\d+)\.(\d+)\.(\d+)"
    r"(?:-([0-9A-Za-z.\-]+))?"
    r"(?:\+[0-9A-Za-z.\-]+)?$"
)


class InvalidVersionError(ValueError):
    """Строка не является версией semver."""


def version_key(version: str) -> tuple:
    """Строит ключ сортировки semver.

    Args:
        version: Строка вида `0.8.0` или `0.8.0-beta.1`.

    Returns:
        Кортеж, который можно сравнивать оператором `<`.

    Raises:
        InvalidVersionError: Строка не разбирается как semver.
    """
    match = _SEMVER.match(version.strip())
    if not match:
        raise InvalidVersionError(f"Некорректная версия: {version!r}")

    major, minor, patch, pre = match.groups()
    core = (int(major), int(minor), int(patch))

    # Релиз без prerelease старше любого prerelease той же тройки.
    if pre is None:
        return core, 1, ()

    identifiers = []
    for part in pre.split("."):
        if part.isdigit():
            # Числовые идентификаторы сравниваются как числа и всегда
            # младше алфавитных — отсюда ведущий 0 в кортеже.
            identifiers.append((0, int(part), ""))
        else:
            identifiers.append((1, 0, part))
    return core, 0, tuple(identifiers)


def is_newer(candidate: str, current: str) -> bool:
    """`True`, если `candidate` строго новее `current`."""
    return version_key(candidate) > version_key(current)


def is_valid(version: str) -> bool:
    """`True`, если строка разбирается как semver."""
    try:
        version_key(version)
    except InvalidVersionError:
        return False
    return True
