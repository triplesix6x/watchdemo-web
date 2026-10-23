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
