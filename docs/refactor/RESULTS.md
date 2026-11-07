# Результат проверенного этапа

## Статус исходной задачи

**Полный согласованный рефакторинг не завершён.** Подготовлены аудит, контракты, проверенная инфраструктура и ограниченные изменения ниже. Не зафиксировано исполняемое поведение каждого модуля; визуальное соответствие и ускорение homepage на физических телефонах не доказаны. Успешные тесты отдельных сервисов и чистое дерево Git не означают принятие всего приложения.

Источники решений: [спецификация](../REFACTOR-SPEC.md), [аудит](audit.md), [план](implementation-plan.md), [контракты](module-contracts.md), [решения D28–D30](execution-decisions.md).

## Реализовано

- W0 (`49bf6cc`): guards disposable PostgreSQL, collection без внешних соединений, точные QA origins, APIRequestContext/browser guards, изолированные outputs и contained static serving. Производственные Compose, defaults и зависимости не менялись.
- D17 (`e834aae`): реальная гонка двух PostgreSQL connections воспроизвела двойное потребление каждого из трёх видов одноразовых токенов. Locking SELECT теперь повторно проверяет active/unused predicates; проигравший получает существующую ошибку. После исправления — 46 passed. См. [контракт auth](backend-auth-qa.md).
- D18 (`556b4b0`): три сценария доказали повреждение/удаление committed winner-файла проигравшим publisher. Запись теперь идёт во временную приватную область того же filesystem; реальный уникальный INSERT/flush предшествует atomic replace. Обычные имена, metadata, errors и существующий precommit rollback-orphan сохранены. После исправления — 57 passed. Это не DB/filesystem atomicity и не HTTP acceptance. См. [контракт releases](backend-release-qa.md).
- W8 (`81afacf`): удалены избыточные комментарии в пяти Python- и девятнадцати frontend-файлах. Python AST/token streams и frontend compiler output совпали; docstrings, directives, security/order/focus/motion contracts сохранены. См. [доказательства](comment-cleanup.md).
- W1 (`9a86ece`): изолированный production build/static runner, существующий mock graph, реальные mounted `useAsync`/Button/controls, явная representative matrix. Последующее сравнение отклоняет failed/dirty/malformed baseline до создания output. Реальный CLI regression сначала воспроизвёл ошибку, затем прошёл. Автоматического принятия goldens нет.

## Выполненные проверки

Тяжёлые проверки запускались последовательно в Windows Job Object: один CPU, до 4096 MiB, ограничение времени. PostgreSQL был одноразовым и loopback-only; cluster и listeners удалялись после проверки.

| Проверка | Фактический результат |
| --- | --- |
| Auth races и обычные контракты | 46 passed после подтверждённых трёх гонок |
| Финальный объединённый backend-набор с releases | 57 passed; до D18 — 54 passed и 3 точных byte-corruption failures |
| Guarded collection | 65 собранных тестов, без DNS/connect; collection не равна выполнению bodies |
| W1 offline infrastructure | 10 passed; red нового baseline-health regression: 9 passed / 1 failed |
| Mounted browser subset | 4 contexts; B09 stale-result, Dialog Escape/focus-return и Seg keyboard assertions passed; error/network ledger пуст |
| Финальный `frontend/scripts/check.mjs` | Успешно; includes существующие auth/client/ownership и feature checks |
| Полнота реестра | 419 исходных записей, **384 pending** |

Обычное предупреждение о коротком фиктивном HMAC-ключе в изолированном backend-наборе не скрывалось. Реальные credentials, production email/Telegram и рабочие данные не использовались. Подробнее: [verification](verification.md), [QA safety](qa-safety.md), [W1](web-qa.md), [matrix](../browser-refactor-web/contract-matrix.md).

## Homepage: исследование, но не оптимизация

На неизменённом built home один и тот же RX 5700 XT/Edge загрузил fonts с установленным clock и без него. Software rendering зависал и без clock, хотя минимальная страница с тем же built CSS/fonts загружалась. Это отделяет software/full-application association от гипотезы «виноват только virtual clock», но не устанавливает конкретный shader/compositing bottleneck и не объясняет лаги на телефонах.

Кандидаты снижения временных аллокаций hit-testing, повторных position calls и trig calculations не применялись: whole-home выигрыша выше шума и визуальной эквивалентности не доказано. Старый microbenchmark не является таким доказательством. Bloom, DPR, blur, shaders, timing, shared clock и мобильное оформление не упрощались. Никакого заявления о mobile 60 FPS или измеренном ускорении нет.

## Открытые gates и оставшаяся работа

1. W1: у controls repeats три PNG- и два DOM-hash; принятых goldens нет. Остальные route/graphics scenarios не считаются выполненными по наличию сценария в матрице. W6/W7 и visual-dependent извлечения не выполнены.
2. D21/D29 требуют доказанного visual oracle; произвольные pixel tolerance, маски и min/max-envelope не превращают шум в acceptance. D23 требует повторного whole-home сравнения, а не изолированного microbenchmark.
3. Полный W2 и пофайловое покрытие не завершены: 384 записи `pending` остаются обязательствами, а не фиктивным «проверено и оставлено». Auth/releases tests не покрывают все HTTP permissions, legal/quota, bot/mail delivery и deployment boundaries.
4. W3 и дополнительные legal/quota/bot/mail извлечения не делались ради новой иерархии. Их допустимость и конкретные contracts остаются в плане; «не изменено» не подменяет непройденную проверку.
5. Физические iOS Safari/Android Chrome по D06 остаются после deployment. Deployment/push в задачу не входили и не выполнялись. Остальные найденные продуктовые дефекты не исправлялись без отдельного разрешения.

## Git и очистка

Ветка: `refactor/behavior-preserving-audit`, только локальные коммиты. Перед нетривиальными коммитами проведены независимые scoped-проверки корректности/безопасности и качества; подтверждённые замечания устранены и перепроверены.

Удалены все 14 временных worktree обоих проектов и четыре связанные task-ветки, созданные этой задачей. Изменённые исходники предварительно сохранены и проверены в escrow вне репозиториев. Исторические screenshots, previews, licenses и исходные fixtures сохранены. Временные логи/диагностические captures вне Git не являются принятыми или переносимыми эталонами.
