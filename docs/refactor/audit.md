# Аудит watchdemo-web: архитектура, сложность и риски

Статус: сводка read-only аудита и дополнительных разборов. Production-рефакторинг не начат. Строки относятся к исходному рабочему коду; после реализации они могут сдвинуться. Исторические QA-отчёты не выдаются за свежую проверку.

## Архитектурный вывод

В проекте уже существуют полезные границы React feature modules, backend `API/APP/SPI`, юридического evidence/outbox, durable quota и auth ownership. Основной риск — не отсутствие нового framework, а неявные контракты запросов, ресурсов, транзакций и проверки. Рефакторинг должен сделать эти контракты видимыми, а не заменить их универсальной абстракцией.

Не обоснованы: смена state manager, перепись renderer, замена GSAP/Lenis, массовое переименование `API/APP/SPI`, общий repository layer и общий runtime-пакет для независимых consumers. Контракт producer/consumer лучше сначала защитить общими golden JSON fixtures.

Подробная [карта модулей и проверок](module-contracts.md) покрывает frontend, backend, bot, mail, генераторы и инфраструктуру. [План работ](implementation-plan.md) задаёт кандидатов и их gates, но не разрешает реализацию каждого извлечения автоматически.

## Обоснованные структурные направления

| ID | Область | Проблема и безопасная граница |
| --- | --- | --- |
| A01 | Public/internal HTTP routes | Импорт transport helpers из другого route-модуля связывает независимые endpoints. Cookie/input/image helpers можно перенести в transport-local modules, сохранив exact HTTP/error/cookie contracts. FastAPI types не переносить в domain. |
| A02 | Legal service | Manifest acquisition, activation/evidence и outbox orchestration имеют разные причины изменения. Возможна локальная декомпозиция с одним владельцем; locks, identities, transaction scopes, batch commits и immutable history сохраняются. |
| A03 | Quota service | Snapshot construction можно отделить от ledger transitions для читаемости. Не менять SQL, lock order, clock sampling, identity-map refresh, generation и tombstones. Существующая сложность протокола в основном необходима. |
| A04 | Release/crash/support storage | Пути, I/O и use-case orchestration смешаны. Узкие storage seams могут помочь, но исходные publication/failure semantics сначала защищаются oracle. Atomicity fixes не прятать в перенос. |
| A05 | `GhostFibers.tsx` | Shader sources, resources, passes, input и lifecycle сосредоточены в одном крупном модуле. Разделение оправдано только при сохранении constants, seeds, allocation order, pass graph и единого clock. |
| A06 | Home/radar | Frame/interpolation/projection helpers можно отделять от React lifecycle. Idle drift, trail timing, DPR policy и offscreen lifecycle — поведение, не косметические детали. |
| A07 | Shared async hooks | Единый hook не выражает одинаково request identity и mutation ownership. Сначала mounted lifecycle baseline; универсальный latest-wins helper незаметно исправил бы текущие гонки. |
| A08 | Styles | Фактическое mobile glass определяется cascade нескольких ownership-зон. Сначала документировать owning stylesheet и computed styles. Не перемещать правила и не удалять blur как «нейтральную» чистку. |
| A09 | Settings/runtime composition | Import-time globals и чтение настроек усложняют изоляцию тестов. Factories допустимы при доказанном сохранении precedence/lifetime, но не обязательны ради архитектурной симметрии. |
| A10 | Bot/mail | Модули уже достаточно сфокусированы; структурная перепись не обязательна. Приоритет — envelopes, retries, ack/confirm и delivery contracts. «Оставить неизменным» — допустимый результат аудита. |

## Безопасность proof infrastructure

Эти gates должны быть закрыты до запуска соответствующих сценариев. Они не доказывают наличие аналогичной production-уязвимости.

| ID | Приоритет и место | Сценарий и необходимая проверка |
| --- | --- | --- |
| T01 | P1, `web/tests/test_support.py:25,40–46` | `TEST_DATABASE_URL` принимается как произвольная цель, затем выполняется TRUNCATE с CASCADE. Нужен guard disposable database до первого соединения; нельзя запускать suite против произвольного URL. |
| T02 | P1, `frontend/scripts/local-app-qa.mjs:7,15,88–120` | Regex разрешает public `172.*` и `127.example.com`; затем выполняются signup/login/support mutations. `context.request` обходит browser routes. Требуется точный isolated-origin allowlist, запрет credentials/path/redirect escape и negative tests с нулём запросов. |
| T03 | P1 gate, Focus/Ghost QA scripts | Обычный Vite может проксировать `/api` в production, отдельные harnesses допускают произвольный origin. Нужны явные pure/mock-browser/isolated-backend режимы без fallback. |
| T04 | P2, crash test collection | Часть fixtures probing/migration/truncation начинается при collection. Нельзя считать их network-free по отсутствию явного запуска тестового тела. Сначала disposable-target guard и safe collection. |
| T05 | P2, `frontend/scripts/serve.mjs:18–19,29–31,46` | `startsWith(dist)` допускает sibling `dist-backup` через encoded traversal. Проверить `path.relative` containment и malformed URI→400. Это локальный QA server, не production nginx. |
| T06 | Gate, mobile/desktop browser scripts | Существующие пути результатов перезаписывают historical PNG/JSON. Новые baseline/actual outputs должны иметь явные разные каталоги и metadata. Старые материалы сохраняются. |

## Продуктовые дефекты и ограничения

P1 означает возможное нарушение важного security/data-контракта; P2 — локальную некорректность или существенную сложность/ресурсный риск. Статическая трассировка не приравнивается к runtime-воспроизведению. D17 и D18 разрешают только указанные условные исправления. Остальные строки остаются очередью, не разрешением на правку.

| ID | Приоритет и место | Механизм, свидетельство и действие |
| --- | --- | --- |
| B01 | P1, `web/SPI/db_adapter/repositories/token_repo.py:28–40,62–73`, `web/APP/services/auth_service.py:444–453` | Два запроса могут прочитать активный одноразовый токен; `mark_used` блокирует строку, но не перепроверяет used/expiry. Возможен повторный reset/verify/email change. D17: сначала test с двумя соединениями, затем отдельная atomic-consume коррекция при подтверждении. Обычные успех/ошибки/expiry/rollback сохраняются. |
| B02 | P1, `web/APP/services/release_service.py:166–194,207–224` | Final file записывается до DB arbitration, неудачная загрузка удаляет путь. Конкуренция одной версии может повредить успешный артефакт. D18: изолированный reproducer и отдельная безопасная публикация при подтверждении. |
| B03 | P1, `web/APP/services/support_service.py:166–202,220–232` | Dedupe выполняется до ticket lock, после блокировки не повторяется; нет unique inbound ID. Перекрывающиеся retry могут дублировать message/unread. Проверить двумя запросами после безопасной fixture gate. |
| B04 | P2, `web/APP/services/crash_service.py:160–180,257–267` | Общий `.part` и cleanup конкурируют; PDB/exe заменяются раздельно. Нужны failed/concurrent upload и pair-consistency тесты. |
| B05 | P2, `web/APP/rate_limiter.py:16–29` | Key buckets не удаляются. Накапливаются одноразовые ключи. Eviction может быть эквивалентной оптимизацией только при сохранении точной expiry boundary и allow/deny. Потребление памяти пока не измерено. |
| B06 | P2, auth/support async handlers | Bcrypt cost 12 и синхронный file I/O могут блокировать worker. Это кандидат bounded offload, не измеренный bottleneck. Сохранить hash/errors, порядок side effects и memory bounds. |
| B07 | P2, `web/main.py:19–36` | Bare lifespan yield не гарантирует teardown после исключения, dispose БД не включён. Exception-safe cleanup меняет failure-сценарий и не должен скрываться в structural extraction. |
| B08 | P2, `web/APP/utils_version.py:12–15,35–54` | Parser принимает `2.0.0-rc..1`, `01.0.0`, `1.0.0-01`, `1.0.0+build..1`, Unicode core digits. Чистая probe это воспроизвела. Строгий SemVer меняет accepted input; сначала проверить совместимость/существующие записи, отдельно согласовать. |
| B09 | P2, `frontend/src/lib/useAsync.ts:26–48` | Generation guards dependencies, но не различает порядок refresh/initial. Старый результат может заменить новый. Нужен mounted deferred-order reproducer, не только hook source check. |
| B10 | P2, admin `useAdmin.ts:19–34`, Releases optimistic update/rollback | Single busy key и whole-row rollback не владеют независимыми sibling mutations. Проверить перекрывающиеся изменения; изменение сериализации отдельно согласуется. |
| B11 | P2, CrashGroup draft state | Draft key не включает group ID: A→B с одинаковыми saved fields может оставить draft A, направленный на B. Нужен реальный route navigation test. |
| B12 | P2, `frontend/src/features/home/useStory.ts:63,82–99,148–153` | Fonts/frames promise может создать работу после cleanup. Это не доказательство постоянного leak: tween конечен. Проверить delayed resolution/unmount перед изменением lifecycle. |
| B13 | P2, `GhostFibers.tsx:570–586,736–743,1172–1177` | Partial GPU allocation не имеет полного failure cleanup. Нужна инъекция ошибки на каждом этапе и ресурсный census. |
| B14 | P2, Home/Lenis preference handling | Reduced-motion частично captured once, background подписывается live. Согласование поведения требует отдельного решения и actual preference-change тестов. |
| B15 | P2, engine/react, Help, Changelog hash handling | `decodeURIComponent` на malformed hash может бросить URIError. Проверить URL vectors; graceful fallback меняет поведение ошибки. |
| B16 | P2, admin filters/page parser | Draft controls не всегда синхронизируются с history; допускаются fraction/Infinity page values. Нужны back/forward и boundary tests. |
| B17 | P2, `frontend/src/api/mock/support.ts:281–288` | Перед reopening conflict 409 меняется assignee; rejected combined PATCH оставляет mutation. Это mock defect, не доказанный production API defect. |

### Deployment и доступность

`docker-compose.yml:64–67,80–82` публикует backend `8000:8000`, создавая прямой ingress помимо frontend/Traefik/CrowdSec. Auth этим не обходится. Host-доступ описан эксплуатационной документацией; Internet exposure/firewall не проверены. Удалять публикацию или менять bind в эквивалентном рефакторинге нельзя — это отдельное deployment/security решение.

В CSS найдены кандидаты reduced-motion cascade: `frontend/src/styles/components.css:12–16`, `controls.css:253–269` и более поздние overlays/feedback. Требуется computed-style reproducer. Для white text на hover primary `#5b97f0` и danger `#fb7185` статический расчёт даёт примерно 2,94:1 и 2,69:1 при обычном малом тексте; actual composited-state проверка ещё не выполнена. Исправление цветов меняет внешний вид и требует отдельного разрешения. Эти строки не являются одобренными изменениями.

## Мобильная производительность

Пока установлены только гипотезы, не измеренный bottleneck:

- GhostFibers: 3×72×260 = 56 160 ribbon quads на frame плюс dust и многоступенчатый bloom; background уже использует DPR 1.
- Одновременно работают Canvas radar, backdrop blur, text sheen и Lenis.
- Radar idle drift продолжает redraw; удаление drift меняет поведение.
- Offscreen unmount/re-entry может пересоздавать renderer; постоянное residency изменяет memory/restart contract.
- Исторический software radar microbenchmark не измеряет whole-home compositing, GPU и физический iPhone.

Последовательность: whole-home trace и fixed-time frames → diagnostic-only изоляция компонентов → attribution CPU/Canvas/WebGL/paint/allocations → одна эквивалентная оптимизация → повторное полностраничное сравнение. Нельзя обещать 60 FPS на телефоне из одноядерного headless Windows запуска.

Полезные официальные источники, просмотренные при планировании:

- https://web.dev/articles/animations-guide — compositor/paint и свойства анимации.
- https://webkit.org/blog/8970/how-web-content-can-affect-power-usage/ — visible-only work, координация таймеров, canvas redraw и overdraw.
- https://developer.chrome.com/docs/devtools/remote-debugging — измерение на устройстве.
- https://developer.chrome.com/docs/devtools/device-mode — границы эмуляции.

Эти материалы задают метод, но не подтверждают виновника текущего jank.

## Комментарии, dead code и сохранение полезной сложности

Кандидаты на удаление: пересказ синтаксиса, ложные async cleanup/preload гарантии и дубли описаний. Причины locks, retries, cache tombstones, cookie queues, legal evidence, delivery semantics, compatibility, лицензии и операционные ограничения сохраняются.

`isTouch`/`isMobile` — лишь кандидаты dead exports до полного caller/export/script/preview поиска. FocusHero/Topography используются preview-сценариями и не являются автоматически мёртвым кодом. Draft legal releaseSequence 0, generated catalogs, immutable revisions и historical QA намеренны. Большой файл сам по себе не доказывает необходимость новой иерархии.

## Текущее доказательство и границы

Новые исходные проверки: subscription 7 passed, выбранный PostgreSQL suite 33 passed, bot 28 passed, mail 175 passed, frontend check runner exit 0. Они не доказывают полноту backend suites, безопасность всех QA scripts, broker restart/delivery, DOM/visual parity, physical mobile smoothness или production ingress.

Первичные и follow-up разборы закрыли заявленные исходниковые пробелы. Полный dependency/license inventory, бинарные assets, все historical prototypes и live deployment остаются отдельными границами. Настоящие секреты не читались для проверки. Финальные статусы модулей и известных ограничений записываются после реализации, а не заранее.
