# Выкладка: поддержка, отчёты о падениях, бот

Что едет: чат поддержки на сайте и бот @watchdemopro_bot, раздел «Поддержка» в админке, приём отчётов о падениях и раздел «Падения», исправление прокрутки в админке. Миграции `0003_crash_reports` и `0004_support`, два новых тома, пакет `llvm` в образе `web`, новые правила в `nginx.conf`, новый контейнер `bot` (бот на aiogram, long polling, без вебхука).

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

## 4. Секреты в `.env`

`TELEGRAM_BOT_TOKEN` в `.env` уже есть, его читает только контейнер `bot`. Добавьте общий секрет `web` и `bot`: им бот подписывает запросы к внутреннему API `web`.

```sh
grep -q '^INTERNAL_API_TOKEN=' .env || echo "INTERNAL_API_TOKEN=$(openssl rand -hex 32)" >> .env
grep -cE '^(TELEGRAM_BOT_TOKEN|INTERNAL_API_TOKEN)=' .env
```

Вторая команда должна вывести `2`. Значения в чаты и логи не копируйте.

С сервера в РФ `api.telegram.org` напрямую недоступен, поэтому боту нужен прокси за рубежом. Добавьте его в `.env` одной строкой, подставив данные от продавца:

```sh
echo 'TELEGRAM_PROXY=socks5://ЛОГИН:ПАРОЛЬ@ХОСТ:ПОРТ' >> .env
```

Для HTTP-прокси схема `http://ЛОГИН:ПАРОЛЬ@ХОСТ:ПОРТ`. Если в пароле есть `@`, `:` или `/`, закодируйте их (`%40`, `%3A`, `%2F`). Через прокси ходят только запросы к Telegram, `web` и RabbitMQ бот вызывает напрямую. Проверьте, что Telegram через прокси отвечает:

```sh
set -a; . ./.env; set +a
curl -s -m 15 -x "${TELEGRAM_PROXY/socks5:/socks5h:}" "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getMe"
```

В ответе должно быть `"ok":true` и `"username":"watchdemopro_bot"`. Если команда висит 15 секунд и ничего не печатает, прокси не работает, и бот с ним тоже не запустится. Бот подключается к RabbitMQ с теми же `RABBITMQ__*`, что и `mailer`, их добавлять не нужно.

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
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:8000/internal/support/telegram/contact
docker compose logs --since 10m web | grep -i 'periodic pass failed' || echo 'no periodic errors'
```

- `llvm-symbolizer` печатает версию.
- Вторая команда печатает `ok`.
- `/app/tiers` отвечает JSON.
- Запрос к внутреннему API без токена печатает `401`. Если там `404`, `web` не видит `INTERNAL_API_TOKEN`: проверьте шаг 4 и повторите `up`.
- Последняя команда печатает `no periodic errors`.

`mailer` в этом релизе не менялся, его не трогаем.

## 7. Пересобрать фронтенд

```sh
docker compose up -d --build frontend
```

В `nginx.conf` поднят лимит тела до 11 МБ для `/api/v1/support/` и `/api/v1/admin/support/`. Без него скриншоты в поддержку отбивались бы ошибкой 413.

## 8. Запустить бота

Только после шага 6: бот пишет во внутренний API `web`, которого до рестарта нет.

Бот забирает сообщения long polling, вебхук ему не нужен. Пока у бота стоит вебхук, Telegram отвечает на `getUpdates` ошибкой 409, поэтому сначала проверьте:

```sh
set -a; . ./.env; set +a
curl -s -m 15 -x "${TELEGRAM_PROXY/socks5:/socks5h:}" "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
```

В ответе должно быть `"url":""`. Если `url` не пустой, снимите вебхук и проверьте ещё раз:

```sh
curl -s -m 15 -x "${TELEGRAM_PROXY/socks5:/socks5h:}" "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook"
```

Сам бот вебхук не трогает: если он найдёт вебхук при старте, то напишет об этом в лог и остановится.

```sh
docker compose up -d --build bot
docker compose logs --since 5m bot
```

В логе должны быть строки `Start polling`, `Run polling for bot @watchdemopro_bot` и `[consumer] listening on queue 'telegram_out'`, и не должно быть `Traceback`. `docker compose ps bot` показывает контейнер в состоянии `running`, а не `restarting`.

## 9. Проверить поддержку

1. Напишите боту `/start`. Он ответит приветствием и кнопкой, ведущей в «Помощь».
2. Напишите боту любой текст. Сообщение появится в админке → «Поддержка», а счётчик непрочитанных на пункте меню станет 1.
3. Ответьте из админки. Ответ придёт в Telegram, тикет перейдёт в «Ждём клиента». Пока бот отправляет ответ, под ним видна метка «Отправляется»; в течение 10 секунд она исчезает. Если вместо неё появилась «Не доставлено», причина во всплывающей подсказке метки, а подробности в `docker compose logs bot`.
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

1. Остановите бота:
   ```sh
   docker compose stop bot
   docker compose rm -f bot
   ```
2. Откатите схему. **Это безвозвратно удаляет всю переписку поддержки и все отчёты о падениях:**
   ```sh
   docker compose exec web poetry run alembic downgrade 0002_locale_changelog
   ```
3. Верните код (`git checkout <предыдущий коммит>`), затем выполните `docker compose up -d --build web` и `docker compose up -d --build frontend`.
4. Если пострадали данные, восстановите бэкап из шага 2 через `pg_restore`.

Тома `watchdemo_symbols_data` и `watchdemo_support_data` можно оставить: старый код их не использует.
