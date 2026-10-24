# Выкладка редизайна (ветка redesign/site)

Порядок важен: миграция до рестарта `web`, `mailer` до `web`, чтобы новые письма не попали к старому мейлеру.

1. **Бэкап БД.**
   ```sh
   docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backup-$(date +%F).dump
   ```
   Проверьте, что файл не пустой.

2. **Код.** `git pull` в каталоге проекта. `web/` и `mail/` смонтированы в контейнеры томами, пересборка им не нужна.

3. **Миграция** в контейнере `web`:
   ```sh
   docker compose exec web poetry run alembic current
   docker compose exec web poetry run alembic upgrade head
   ```
   Цепочка миграций: `907b2d179318` → `2719b4ef61f3` → `03b05dc2017c` → `0002_locale_changelog`. Первые три раньше лежали только на сервере неотслеживаемыми файлами, теперь они в репозитории. Перед `git pull` переименуйте серверные копии (`mv web/migrations/versions/2026_*.py ~/migrations-backup/`), иначе git откажется их перезаписать. `alembic current` до миграции должен показывать `03b05dc2017c`.

   Миграция `0002` добавляет `users.locale`, `one_time_tokens.payload` и `releases.show_in_changelog`. У всех уже опубликованных релизов флаг будет `false`: старая админка называла заметки внутренними, поэтому наружу они не уходят. Новые релизы по умолчанию получают `true`.

4. **Мейлер:** `docker compose restart mailer`.

5. **API:** `docker compose restart web`. Проверка: `curl -s https://watchdemo.pro/api/v1/app/tiers` отвечает JSON.

6. **Фронтенд:** `docker compose up -d --build frontend`.

## Старые заметки к релизам

Пока флаг выключен, заметки релиза не видны ни в публичной истории изменений, ни в `/app/latest` (кнопка «Скачать»).

1. Админка → «Релизы». Нужна роль admin.
2. Откройте релиз и перечитайте заметки: в них могли остаться внутренние пометки. Поправьте текст, если нужно.
3. Включите «Показывать в истории изменений» и сохраните.

То же через API: `PATCH /api/v1/admin/releases/{id}` с телом `{"show_in_changelog": true}` и при необходимости `"notes": "..."`.

## Откат

`docker compose exec web poetry run alembic downgrade 03b05dc2017c`, затем верните код и перезапустите `mailer` и `web`. Downgrade удаляет токены смены почты и новые колонки. Если что-то пошло не так с данными, восстановите бэкап из шага 1 через `pg_restore`.

## Отчёты о падениях (ветка feat/web-crash)

Сначала бэкап БД, как в шаге 1 выше, и `git pull`.

1. **Том символов.** `docker-compose.yml` объявляет `watchdemo_symbols_data` и монтирует его только в `web` как `/symbols`. В nginx фронта его нет, PDB наружу не раздаются. Отдельно создавать не нужно, compose создаст том при `up`.

2. **Образ `web`.** В `web/Dockerfile` добавлен пакет `llvm`, он ставит `/usr/bin/llvm-symbolizer`. Пересоберите и поднимите:
   ```sh
   docker compose up -d --build web
   docker compose exec web llvm-symbolizer --version
   ```
   Путь к бинарю задаёт `SYMBOLS__SYMBOLIZER` (по умолчанию `llvm-symbolizer`), каталог `SYMBOLS__DIR` (по умолчанию `/symbols`).

3. **Миграция** `0003_crash_reports` создаёт `crash_groups` и `crash_reports`:
   ```sh
   docker compose exec web poetry run alembic upgrade head
   ```

4. **Символы релиза.** `scripts/publish-release.ps1` в репозитории приложения после загрузки инсталлятора шлёт PDB и exe на `POST /api/v1/admin/releases/{version}/symbols` (multipart `pdb`, `exe`, до 300 МБ на файл, роль admin). Вручную то же самое:
   ```sh
   curl -fsS -H "Authorization: Bearer $ADMIN_TOKEN" \
     -F pdb=@src-tauri/target/release/watchdemo.pdb \
     -F exe=@src-tauri/target/release/watchdemo.exe \
     https://watchdemo.pro/api/v1/admin/releases/0.8.1/symbols
   ```
   Файлы ложатся в `/symbols/<version>/watchdemo.pdb` и `watchdemo.exe`. Повторная загрузка той же версии заменяет их. Символизация идёт в момент приёма отчёта, поэтому отчёты, пришедшие до загрузки PDB, так и останутся со смещениями.

5. **Проверка.** Соберите релиз с тестовой паникой, отправьте отчёт из диалога падения и откройте его в админке «Падения». В стеке должны быть имена функций `watchdemo_lib::...` и `file:line`. С сервера то же видно напрямую:
   ```sh
   docker compose exec web llvm-symbolizer --relative-address --obj=/symbols/0.8.1/watchdemo.exe 0x1b08
   ```
   Адрес берите из `frames[].offset` отчёта минус 1. Если вместо функции `??`, PDB не от этой сборки.

6. **Хранение.** Отчёты старше 90 дней удаляет `purge_old_crash_reports` из `APP/services/crash_service.py`, группы остаются. Её вызывает периодическая задача из раздела 3.3 спеки, которая приходит с веткой поддержки. Без неё отчёты копятся.

   Отчёт, принятый до загрузки PDB, группируется по `location`, а после загрузки по именам функций, поэтому одно падение может попасть в две группы. Загружайте символы до выдачи релиза пользователям.

Откат: `docker compose exec web poetry run alembic downgrade 0002_locale_changelog` удаляет обе таблицы вместе с отчётами. Том символов можно оставить.
