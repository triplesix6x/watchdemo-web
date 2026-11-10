# Итоги аудита и согласованных изменений

## Объём и смысл результата

[source-audit.json](source-audit.json) содержит 432 пофайловых контракта, списка тестов и решения по watchdemo-web. Вместе с 329 desktop-модулями это 761 запись. Первые 749 файлов рассмотрены семью независимыми read-only направлениями; последующие 12 QA-модулей дополнены scoped-проверками. В записи сохранены исходный и текущий SHA256, причины сохранения или изменения и границы evidence.

**План тестов не выдаётся за исполнение каждого сценария.** Нулевой pending в реестре означает завершённые source-dispositions, а не универсальную runtime/visual acceptance. Необоснованные извлечения отклонены явным решением retain, а не оставлены обязательным переписыванием. Новые найденные продуктовые баги сохранены в очереди без изменения текущего поведения.

Основания: [спецификация](../REFACTOR-SPEC.md), [аудит](audit.md), [план](implementation-plan.md), [контракты](module-contracts.md), [итоговые решения](completion-decisions.md).

## Изменения

- W0 ограничивает QA точными origins, disposable PostgreSQL, browser/APIRequestContext guards, свежими внешними outputs и contained static serving. Production Compose, defaults и зависимости не менялись.
- D17: реальная гонка двух PostgreSQL connections воспроизвела двойное потребление трёх видов одноразовых токенов. Locking SELECT повторно проверяет active/unused predicates; проигравший получает существующую ошибку. После разрешённого исправления — 46 passed. См. [auth QA](backend-auth-qa.md).
- D18: три сценария доказали повреждение committed winner-файла проигравшим publisher. Приватная staging-область на том же filesystem, реальный unique INSERT/flush и atomic replace защищают победителя. Обычные имена, metadata, errors и прежний precommit rollback-orphan сохранены. После исправления — 57 passed. Это не DB/filesystem atomicity. См. [release QA](backend-release-qa.md).
- W3 переносит unchanged cookie/upload/input helpers в `web/API/http/`; четыре callers мигрированы, старые определения удалены без compatibility wrapper. Frozen oracle проверяет порядок cookies, flags/TTL, bounded upload, MIME, ошибки и cancellation. См. [HTTP helper QA](http-helpers-qa.md).
- W7 переносит четыре private pure projection/matrix helpers в sibling-модуль GhostFibers. Arithmetic order, `number[]`, shaders, pass graph, timing и lifecycle сохранены. См. [hardware output evidence](home-output-qa.md).
- Удалены избыточные комментарии в пяти Python- и девятнадцати frontend-файлах; Python AST/token streams и frontend compiler output сохранены. Дополнительно убраны Alembic template placeholders с точным AST, включая imports/docstrings. Процент удаления не был целью. См. [comment QA](comment-cleanup.md) и [source witness](source-cleanup-witness.json).

## Выполненные проверки

Проверки выполнялись последовательно в Windows Job Object с одним CPU, до 4096 MiB и deadline. PostgreSQL был одноразовым и loopback-only; реальные email/Telegram и production credentials не использовались.

| Проверка | Фактический результат |
| --- | --- |
| Полный owned PostgreSQL backend-набор | 264 passed, 1 skipped, 38 subtests |
| Bot | 28 passed |
| Mail | 175 passed |
| W7 offline old/new production checks | 11 passed |
| Frontend `npm run check` | Успешно |
| Финальный TypeScript `tsc --noEmit` | Успешно |
| Actual GPU output | 3 hardware contexts × 4 states; 12 nonempty exact RGBA captures |
| Whole-home timing | 15 samples; ускорение выше repeat noise не доказано |
| Alembic cleanup | AST точно совпадает, side-effect imports и docstrings сохранены |
| Source inventory `--require-accepted` | 432 записи, 0 pending; не runtime acceptance |

Единственный backend skip требует внешнего crash-symbolizer build/symbols; он не считается passed. Bot/mail используют изолированные settings и fake providers. Collection guards, owned-loopback counters и реальные тела тестов различаются в evidence; сбор тестов не выдаётся за выполнение.

Mounted representative subset проверил B09 stale-result, Dialog Escape/focus-return и Seg keyboard с пустым error/network ledger. Это не полный принятый visual baseline всех маршрутов. Code-пакеты прошли независимые scoped-проверки корректности/безопасности и сопровождаемости; статические reviewers не заявляют запуск тестов.

## Homepage: точное соответствие, без заявления об ускорении

Реальные production graphs baseline/repeat/candidate на RX 5700 XT/ANGLE D3D11 дали точное совпадение framebuffer в четырёх фиксированных pointer/visibility состояниях. Нет masks, blur, произвольного tolerance, software GPU или shader substitutions. Это конечное доказательство для extraction, а не всех устройств. `readPixels` намеренно синхронный и не используется как benchmark.

Whole-home профиль использовал десять baseline и пять candidate samples, меняя их порядок. Median frame interval обоих — 6.9 ms, что соответствует пределу примерно 144 Hz этого хоста. p95 median — 7.85 против 8.0 ms при baseline range 1.3 ms. Ускорение не подтверждено; физическая mobile smoothness из этого не следует. [Сохранённый профиль](home-output-profile.json) содержит среду, порядок, CPU accounting, summary и SHA внешней raw-диагностики.

Bloom, DPR, blur, shaders, частота анимации и оформление не упрощались ради показателя. Старый radar microbenchmark с hybrid baseline и tolerant comparison не используется как acceptance. Software-renderer font stall не объявлен измерением реального телефона.

## Решения сохранить и оставшиеся ограничения

- Legal/quota/support/crash services сохраняют transaction, lock, outbox и lifecycle ownership. Дополнительные фасады и иерархия без показанного упрощения не добавлены. Пояснение есть у каждого candidate в source-audit.
- useTokenLink identity, Composer newer-draft clearing, SupportImage stale failure и прочие новые behavior findings не исправлялись под видом рефакторинга.
- Глобальные диагностические captures W1 не стали принятыми goldens. Наличие контракта не означает исполнение всех auth/permission/layout/route сценариев.
- Legacy browser scripts с fixed outputs оставлены историческими diagnostics, не сертифицированными final acceptance tools. Они не запускались ради получения результата.
- Физические iOS Safari/Android Chrome по D06 остаются согласованной проверкой после deployment. Deployment и push в задачу не входят. Изменённой картинки или обещания mobile 60 FPS нет.

## Git и артефакты

Рабочая ветка — `refactor/behavior-preserving-audit`, только локальные коммиты. Исторические полезные screenshots, previews, licenses и fixtures сохранены. Raw traces/video/failure captures не добавляются в Git. Дополнительные 10 task-owned worktree обоих проектов удалены после проверенного внешнего escrow; ранее были удалены ещё 14. Чужой locked desktop-worktree не затронут. Escrow: `C:/Temp/watchdemo-refactor-final-worktree-escrow-20261108/manifest.json`. Финальная чистота Git проверяется после локального коммита отчёта.
