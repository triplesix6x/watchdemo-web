# Полное локальное приложение

`docker-compose.local.yml` запускает настоящий frontend и backend, PostgreSQL,
Redis, RabbitMQ и локальный перехватчик сообщений. Это больше не mock-просмотр.
Не объединяйте этот файл с производственным `docker-compose.yml`.

## Запуск

Требования: Linux с Docker Engine и Compose, Node-зависимости frontend, OpenSSL.
Устанавливать доверие к сертификату в систему скрипты не пытаются.

```bash
# Из корня репозитория; тяжёлые операции выполняются последовательно.
docs/scripts/run_limited_check.sh npm --prefix frontend run build
bash docs/local/build-image.sh
bash docs/local/up.sh
```

Скрипт выводит фактический адрес контейнера. В проверенном запуске:

- приложение: **https://172.19.0.7:8443**;
- локальные сообщения: **https://172.19.0.7:8443/__local/mail**.

Адрес может измениться после пересоздания сети. Используйте адрес из `up.sh`,
а не считайте указанный выше постоянным. Прямой доступ к внутреннему IP работает
с Linux-хоста; это не инструкция для Docker Desktop или другого устройства.
Внешних опубликованных портов нет, сеть остаётся `internal: true`.

Сертификат самоподписанный, действителен 30 дней и хранится только в
`docs/local/certs/` (каталог исключён из Git). Браузер покажет предупреждение:
проверьте локальный адрес и примите решение вручную. Cookie `Secure` включён.
HTTP на порту 8080 нужен для локальной визуальной проверки, а не для проверки
сохранения авторизации после перезагрузки страницы.

Образ `watchdemo-local-backend:dev` собирается установкой зависимостей в отдельном
контейнере с лимитами 768 MiB, 0.75 CPU, 128 процессов и без дополнительного swap.
В образ не копируется репозиторий. Версии зависимостей взяты из `web/poetry.lock`.

После изменения backend lock-файла обновите локальные зависимости:

```bash
docs/scripts/run_limited_check.sh python docs/local/lock-constraints.py
docs/scripts/run_limited_check.sh uv pip compile web/pyproject.toml \
  --python-version 3.14 --constraint docs/local/constraints.txt \
  -o docs/local/requirements.txt
bash docs/local/build-image.sh
bash docs/local/up.sh
```

## Что реально работает

- FastAPI запускается с обычным lifespan: подключает RabbitMQ и Redis, запускает
  периодические задачи. До запуска применяется `alembic upgrade head`.
- Frontend собран обычным `npm run build`: mock API не включён.
- Регистрация создаёт запись в локальном PostgreSQL. Сообщение проходит настоящий
  RabbitMQ и появляется в `/__local/mail`. Ссылка подтверждения ведёт на локальный
  сайт. Перехватчик не отправляет email и сообщения Telegram наружу.
- Можно зарегистрировать собственный тестовый аккаунт и подтвердить его через
  локальные сообщения. Готовых паролей пользователей в репозитории нет.
- Создание тестового администратора заблокировано политикой выполнения; готового
  администратора и проверенного входа в административную часть нет.

Это не копия производственных данных. Здесь нет опубликованных Windows-релизов,
PDB, платёжного провайдера, Telegram-бота или доставки через Resend. Проверки этих
интеграций не заявляются. Юридические документы остаются черновиками.

## Изоляция и хранение

- Команды Compose всегда используют `--env-file /dev/null`.
- Производственный корневой `.env` не читается и не монтируется.
- В backend монтируются только исходные `main.py`, `API`, `APP`, `SPI`, Alembic и
  миграции — не домашний каталог, не `.venv` и не весь корень репозитория.
- Все пароли сервисов и JWT-secret в локальном Compose синтетические, только для
  этой закрытой сети. Их нельзя переносить в доступное извне окружение.
- Контейнеры имеют отдельные CPU/RAM/PID-лимиты. Web/nginx/перехватчик работают
  непривилегированно, с read-only rootfs и `no-new-privileges`.
- PostgreSQL сохраняется в отдельном томе `watchdemo-local_local-db`.
- Сообщения перехватчика, Redis и файлы вложений/релизов/символов в `/tmp`
  недолговечны: теряются при перезапуске соответствующего контейнера. Табличные
  данные поддержки сохраняются в PostgreSQL.
- Другие проекты и работающие контейнеры не изменяются.

## Проверки

```bash
docs/scripts/run_limited_check.sh npm --prefix frontend run check
docs/scripts/run_limited_check.sh python docs/scripts/build_legal_catalog.py --check

docs/scripts/run_limited_check.sh env \
  QA_ORIGIN=http://172.19.0.7:8080 \
  QA_OUTPUT_DIR="$HOME/.cache/watchdemo-ui-final-qa" \
  node frontend/scripts/local-app-qa.mjs

docs/scripts/run_limited_check.sh env \
  QA_OUTPUT_DIR="$HOME/.cache/watchdemo-ui-final-qa" \
  node frontend/scripts/radar-perf.mjs
```

Первый браузерный сценарий использует реальный API, создаёт обычный синтетический
аккаунт, подтверждает его через очередь и отправляет локальное сообщение в
поддержку. Снимки делаются с reduced motion; отдельная мобильная проверка карты
включает движение, но использует reduced transparency, чтобы не измерять WebGL
фона на программном GPU. Доступ к внешним ресурсам блокируется. Полная проверка
HTTPS-cookie в браузере ограничена отсутствием доверия к локальному сертификату.

Результаты: [UI-RESTORATION-VERIFICATION.md](UI-RESTORATION-VERIFICATION.md).

## Остановка

```bash
docker compose --env-file /dev/null -f docker-compose.local.yml stop
```

Том PostgreSQL при этом сохраняется. Не используйте производственный Compose
для управления этими контейнерами. Деплоя и push эти команды не выполняют.
