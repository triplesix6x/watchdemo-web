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

## Поддержка: чат на сайте и бот в Telegram

Ветка `feat/web-support`. Порядок общий с инструкцией выше: бэкап, `git pull`, миграция, рестарт `web`, пересборка `frontend`. Отличия:

1. **Том для картинок.** `docker-compose.yml` монтирует `watchdemo_support_data` в `web` по пути `/support` (это `SUPPORT__DIR` по умолчанию). В `frontend` том не монтируется: картинки отдаёт FastAPI после проверки доступа. Docker создаст том сам при `docker compose up -d web`; после этого проверьте, что каталог доступен на запись:
   ```sh
   docker compose exec web sh -c 'touch /support/.probe && rm /support/.probe && echo ok'
   ```

2. **Миграция `0004_support`** создаёт `support_contacts`, `support_tickets` и `support_messages`. Она идёт после `0003_crash_reports`, так что один `alembic upgrade head` применяет обе. После неё `alembic current` показывает `0004_support`.

3. **Переменные в `.env`.** `TELEGRAM_BOT_TOKEN` уже есть. Добавьте секрет вебхука: 1–256 символов из `A-Z`, `a-z`, `0-9`, `_` и `-`.
   ```sh
   echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env
   ```
   Без токена бот выключен и `/api/v1/telegram/webhook` отвечает 404. Без секрета вебхук отвечает 401 на всё. Окна статусов можно поменять через `SUPPORT__RESOLVED_CLOSE_HOURS` (72) и `SUPPORT__PENDING_RESOLVE_DAYS` (7).

4. **Рестарт `web`** (`docker compose up -d web`, чтобы подхватить новый том и `.env`) и **пересборка `frontend`** (в `nginx.conf` поднят лимит тела до 11 МБ для `/api/v1/support/` и `/api/v1/admin/support/`).

5. **Вебхук.** Только после рестарта `web`, иначе Telegram получит 404 и начнёт копить очередь. Команда с сервера, где лежит `.env`:
   ```sh
   set -a; . ./.env; set +a
   curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
     -H 'Content-Type: application/json' \
     -d "{\"url\": \"https://watchdemo.pro/api/v1/telegram/webhook\", \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\", \"allowed_updates\": [\"message\", \"edited_message\"]}"
   curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
   ```
   В ответе `getWebhookInfo` должны быть этот `url`, `pending_update_count` около нуля и пустой `last_error_message`. Проверка: напишите боту `/start`, он ответит приветствием с кнопкой «Открыть «Помощь»». Любое другое сообщение появится в админке → «Поддержка».

   Пока вебхук стоит, `python -m APP.telegram_poll` (локальный опрос через `getUpdates`) с этим токеном работать не будет: Telegram отвечает 409. Для разработки заведите отдельного бота.

6. **Фоновая задача** стартует вместе с `web` и раз в 5 минут закрывает решённые обращения старше 72 часов и переводит в «решено» те, где пользователь молчит 7 дней. Advisory-блокировка в Postgres даёт сделать проход только одному воркеру.

Откат поддержки: `docker compose exec web poetry run alembic downgrade 0003_crash_reports` удаляет три таблицы вместе с перепиской. Снимите вебхук: `curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"`. Картинки остаются в томе `watchdemo_support_data`.

## Откат

`docker compose exec web poetry run alembic downgrade 03b05dc2017c`, затем верните код и перезапустите `mailer` и `web`. Downgrade удаляет токены смены почты и новые колонки. Если что-то пошло не так с данными, восстановите бэкап из шага 1 через `pg_restore`.
