# Локальный просмотр дизайна в Docker

Это отдельная mock-сборка интерфейса, без backend, базы, платежей, реальной почты и production-конфигурации. Главная страница сейчас падает; см. известное ограничение ниже.

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
- `/` и `/en` — главная, сейчас с известным runtime-сбоем.

API-запросы к `/api` и `/api/` возвращают 503; проксирования нет. Непредусмотренные страницы возвращают настоящие локализованные 404. Все ответы содержат noindex и no-store.

```sh
# Статус
docker compose --env-file /dev/null -f docker-compose.local.yml ps
# Остановить только этот локальный проект
docker compose --env-file /dev/null -f docker-compose.local.yml down
```

## Проверки и известное ограничение

На момент сохранения дизайна `npm run check` проходит все 13 файлов, `build:mock` успешно выполняет TypeScript, клиент, SSR и prerender. Проверены фактические ограничения контейнера, статус healthy, HTTP 200 для основных маршрутов, 404 для отсутствующих страниц RU/EN и 503 для API.

Браузерная проверка на 375/1280 px прошла для `/account`, `/admin` и `/__ui` (6 случаев). Во всех четырёх случаях `/` и `/en` падают с `Cannot read properties of undefined (reading 'y')`. Stack trace указывает на `timeAt` → `sync` → `onUpdate` во время конструктора ScrollTrigger. В `frontend/src/features/home/useStory.ts` начальный `measure()` вызывается после `ScrollTrigger.create`, но callbacks могут выполниться уже внутри создания. Нужно перенести первый `measure()` перед `ScrollTrigger.create`, оставив последующий `sync(st.scroll())`.

Попытка такого изменения была заблокирована Auto Mode из-за отсутствия разрешения на изменение существующего frontend-файла. Исправление не применено. Главная не считается готовой к визуальной приёмке. Браузерные артефакты: `~/.cache/watchdemo-local-preview-qa/report.json` и соседние PNG; внешние/API-запросы блокировались до навигации, таких запросов зафиксировано 0.

Очистка временных директорий и изменение корневого `.gitignore` также заблокированы и не выполнены. Старый `frontend/background-review`, агентские журналы, сборки прототипов и QA-скриншоты не включаются в коммит дизайна. Рабочие зависимости и Python-окружение сохраняются.
