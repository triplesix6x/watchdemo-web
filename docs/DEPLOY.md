# Выкладка: поддержка, отчёты о падениях, бот

Что едет: чат поддержки на сайте и бот @watchdemopro_bot, раздел «Поддержка» в админке, приём отчётов о падениях и раздел «Падения», исправление прокрутки в админке. Миграции `0003_crash_reports` и `0004_support`, два новых тома, пакет `llvm` в образе `web`, новые правила в `nginx.conf`.

Выполняйте шаги строго по порядку. Сначала сервер (шаги 1–10), только потом релиз приложения (шаг 11): новая версия приложения шлёт отчёты на эндпоинт, которого до выкладки нет.

Все команды на сервере запускаются из каталога проекта, где лежат `docker-compose.yml` и `.env`.

## 1. Проверить исходное состояние

```sh
git status
docker compose exec web poetry run alembic current
```

- `git status` не должен показывать изменённых отслеживаемых файлов. Если они есть, разберитесь с ними до `git pull`.
- `alembic current` должен показывать `0002_locale_changelog`. Если там другая ревизия, остановитесь: на сервере не выложен предыдущий релиз (редизайн), и эта инструкция к нему не подходит.

## 2. Бэкап БД

```sh
docker compose exec db sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > backup-$(date +%F).dump
ls -lh backup-$(date +%F).dump
```

Файл не должен быть пустым.

## 3. Код

```sh
git pull
git log -1 --oneline
```

Каталог `web/` смонтирован в контейнер томом, поэтому новый код сразу виден внутри работающего контейнера. Старый процесс продолжает работать на уже загруженном коде до рестарта в шаге 6.

## 4. Секрет вебхука в `.env`

`TELEGRAM_BOT_TOKEN` в `.env` уже есть. Добавьте секрет:

```sh
grep -q '^TELEGRAM_WEBHOOK_SECRET=' .env || echo "TELEGRAM_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env
grep -c '^TELEGRAM_' .env
```

Вторая команда должна вывести `2`. Значения в чаты и логи не копируйте.

## 5. Миграции

Выполняйте до рестарта `web`. Иначе новая фоновая задача и новые эндпоинты обратятся к таблицам, которых ещё нет.

```sh
docker compose exec web poetry run alembic upgrade head
docker compose exec web poetry run alembic current
```

Должно быть `0004_support (head)`. Миграции только создают новые таблицы: `crash_groups`, `crash_reports`, `support_contacts`, `support_tickets`, `support_messages`. Старые данные они не трогают, поэтому работающий старый процесс им не мешает.

## 6. Пересобрать и перезапустить `web`

Пересборка нужна ради `llvm`, он символизирует отчёты. Заодно `up` создаёт тома `watchdemo_symbols_data` и `watchdemo_support_data` и перечитывает `.env`.

```sh
docker compose up -d --build web
```

Проверки:

```sh
docker compose exec web llvm-symbolizer --version
docker compose exec web sh -c 'touch /support/.probe /symbols/.probe && rm /support/.probe /symbols/.probe && echo ok'
curl -s https://watchdemo.pro/api/v1/app/tiers
docker compose logs --since 10m web | grep -i 'periodic pass failed' || echo 'no periodic errors'
```

- `llvm-symbolizer` печатает версию.
- Вторая команда печатает `ok`.
- `/app/tiers` отвечает JSON.
- Последняя команда печатает `no periodic errors`.

`mailer` в этом релизе не менялся, его не трогаем.

## 7. Пересобрать фронтенд

```sh
docker compose up -d --build frontend
```

В `nginx.conf` поднят лимит тела до 11 МБ для `/api/v1/support/` и `/api/v1/admin/support/`. Без него скриншоты в поддержку отбивались бы ошибкой 413.

## 8. Вебхук бота

Только после шага 6. До рестарта `web` Telegram получал бы 404 и копил очередь.

```sh
set -a; . ./.env; set +a
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{\"url\": \"https://watchdemo.pro/api/v1/telegram/webhook\", \"secret_token\": \"${TELEGRAM_WEBHOOK_SECRET}\", \"allowed_updates\": [\"message\", \"edited_message\"]}"
curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

`setWebhook` отвечает `"ok":true`. В ответе `getWebhookInfo` должны быть этот `url`, `pending_update_count` около нуля и пустой `last_error_message`.

## 9. Проверить поддержку

1. Напишите боту `/start`. Он ответит приветствием и кнопкой, ведущей в «Помощь».
2. Напишите боту любой текст. Сообщение появится в админке → «Поддержка», а счётчик непрочитанных на пункте меню станет 1.
3. Ответьте из админки. Ответ придёт в Telegram, тикет перейдёт в «Ждём клиента».
4. Войдите на сайт обычным аккаунтом и откройте «Помощь»: внизу есть чат. Отправьте текст и картинку. Они появятся в админке отдельным тикетом с каналом «сайт».
5. Закройте оба тестовых тикета в админке.

## 10. Проверить админку

1. Под админом в меню есть «Поддержка» и «Падения», обе страницы открываются. «Падения» пока пустые.
2. Под модератором или саппортом есть «Поддержка», но нет «Падений».
3. В разделе «Пользователи» список прокручивается колесом мыши внутри таблицы.

Сервер готов. Фоновая задача раз в 5 минут:

- закрывает решённые обращения старше 72 часов;
- переводит в «Решено» обращения, где клиент молчит 7 дней;
- удаляет отчёты о падениях старше 90 дней.

## 11. Релиз приложения

На машине сборки, в `D:\demo-manager`, на ветке `master` со всеми влитыми изменениями.

1. Поднимите версию: 0.8.1 уже выпущена без новых функций.
   ```powershell
   .\scripts\bump-version.ps1 -Version 0.8.2
   ```
   Закоммитьте изменение версии.
2. Соберите и опубликуйте. Скрипт сам загрузит на сервер exe и PDB этой сборки для символизации.
   ```powershell
   .\scripts\publish-release.ps1 -Notes "..."
   ```
   Чтобы сначала обкатать на тестерах, добавьте `-Channel beta`.
3. Проверьте на сервере, что символы на месте:
   ```sh
   docker compose exec web ls -lh /symbols/0.8.2/
   ```
   Должны быть `watchdemo.pdb` и `watchdemo.exe`. Без них отчёты этой версии придут без имён функций и сгруппируются хуже. Не раздавайте релиз пользователям, пока символы не загружены.
4. Загрузите установщик и `src-tauri\target\release\watchdemo.exe` на VirusTotal. При срабатываниях отправьте ложные срабатывания вендорам, порядок описан в `D:\demo-manager\docs\SMARTSCREEN-AV.md`.

## Откат

1. Снимите вебхук:
   ```sh
   set -a; . ./.env; set +a
   curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"
   ```
2. Откатите схему. **Это безвозвратно удаляет всю переписку поддержки и все отчёты о падениях:**
   ```sh
   docker compose exec web poetry run alembic downgrade 0002_locale_changelog
   ```
3. Верните код (`git checkout <предыдущий коммит>`), затем выполните `docker compose up -d --build web` и `docker compose up -d --build frontend`.
4. Если пострадали данные, восстановите бэкап из шага 2 через `pg_restore`.

Тома `watchdemo_symbols_data` и `watchdemo_support_data` можно оставить: старый код их не использует.
