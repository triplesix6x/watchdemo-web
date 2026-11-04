# Локальный просмотр дизайна в Docker

Это отдельная mock-сборка интерфейса, без backend, базы, платежей, реальной почты и production-конфигурации. Падение главной исправлено; текущая версия дизайна доступна для просмотра.

## Запуск

Из корня репозитория:

```sh
docs/scripts/run_limited_check.sh npm --prefix frontend run check
docs/scripts/run_limited_check.sh npm --prefix frontend run build:mock
docker compose --env-file /dev/null -f docker-compose.local.yml up -d --wait
```

Если зависимости ещё не установлены, сначала выполните `docs/scripts/run_limited_check.sh npm --prefix frontend ci`.

Не объединяйте `docker-compose.local.yml` с production Compose. Флаг `--env-file /dev/null` исключает автоматическую загрузку корневого `.env`. Локальный Compose не содержит `env_file`, backend upstream или production volumes. Сборка выполняется на хосте под ограничениями; контейнер nginx отдельно ограничен 64 MiB RAM без swap и 25% CPU, работает с read-only filesystem и без capabilities.

Сеть Docker оставлена `internal: true`. На текущем Docker Engine опубликованный `127.0.0.1:4520` в такой сети недоступен. Менять изоляцию нельзя без отдельного согласования. На Linux с этого же компьютера можно открыть внутренний адрес контейнера:

```sh
id=$(docker compose --env-file /dev/null -f docker-compose.local.yml ps -q frontend)
docker inspect "$id" --format '{{range .NetworkSettings.Networks}}http://{{.IPAddress}}:8080{{end}}'
```

Адрес текущего запуска: **http://172.19.0.2:8080**. После пересоздания он может измениться. Это адрес контейнера, не внешняя публикация сайта. Docker Desktop и удалённый компьютер могут не иметь доступа к этому адресу.

## Просмотр

- `/account` — кабинет;
- `/admin` — админка;
- `/__ui` — каталог компонентов и выбор mock-пользователя;
- `?mock-user=anon`, `?mock-user=free`, `?mock-user=pro`, `?mock-user=admin` — выбор mock-персоны при открытии URL;
- `/` и `/en` — исправленная главная RU/EN с текущей подключённой композицией.

API-запросы к `/api` и `/api/` возвращают 503; проксирования нет. Непредусмотренные страницы возвращают настоящие локализованные 404. Все ответы содержат noindex и no-store.

```sh
# Статус
docker compose --env-file /dev/null -f docker-compose.local.yml ps
# Остановить только этот локальный проект
docker compose --env-file /dev/null -f docker-compose.local.yml down
```

## Проверки и известное ограничение

На момент сохранения дизайна `npm run check` проходит все 13 файлов, `build:mock` успешно выполняет TypeScript, клиент, SSR и prerender. Проверены фактические ограничения контейнера, статус healthy, HTTP 200 для основных маршрутов, 404 для отсутствующих страниц RU/EN и 503 для API.

Первоначальная браузерная проверка воспроизвела `Cannot read properties of undefined (reading 'y')` на главной RU/EN. Stack trace: `timeAt` → `sync` → `onUpdate` во время конструктора ScrollTrigger. После прямого разрешения пользователя в `frontend/src/features/home/useStory.ts` первый `measure()` перенесён перед `ScrollTrigger.create`; последующий `sync(st.scroll())` сохранён. Это устраняет обращение к пустому массиву координат при синхронном callback конструктора.

После исправления повторно прошли все 13 файлов source checks и mock-сборка. Финальная браузерная проверка дала **10/10**: `/`, `/en`, `/account`, `/admin`, `/__ui` на 375/1280 px. Проверены HTTP 200, непустой контент, существующий hero главной, отсутствие page errors и горизонтального overflow. Внешние/API-запросы блокировались до навигации; таких запросов зафиксировано 0. Отчёт: `~/.cache/watchdemo-local-preview-fixed-qa/report.json`. Скриншот главной 1280 px с reduced-motion сохранён рядом как `home-1280.png` и просмотрен. Полностраничный screenshot-run и расширенный keyboard-run не завершились по timeout; они не входят в эти 10 успешных проверок.

**Ограничение интеграции дизайна:** сохранённый компонент `frontend/src/features/focus/FocusHero.tsx` не импортируется в текущем `frontend/src/pages/Home.tsx`. Главная использует существующие `.hero` и радар с обновлёнными общими стилями. Старый `frontend/FOCUS-VERIFICATION.md` описывает более полную интеграцию и не является подтверждением текущего состояния Home. Подключение FocusHero и перестройка Home в этом исправлении не выполнялись.

После отдельного разрешения временные файлы перенесены без удаления в `/home/bigboss/.cache/watchdemo-cleanup-20261104-143409` (около 174 MiB): `.aislop/`, `web/.aislop/`, `web/run_create_password.py`, `frontend/background-review/`, `docs/design-focus/{dist,shots,.vite,node_modules}` и `docs/design-review/shots/`. Добавлены правила корневого `.gitignore` для агентского состояния, frontend caches и дизайн-QA. Исходники макетов, лицензии, дизайн-изображения и проверки сохранены в Git. Рабочие зависимости `frontend/node_modules` и Python-окружение `web/.venv` оставлены для дальнейшей работы.
