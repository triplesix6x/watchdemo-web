# Итоговые решения по согласованному плану

Эти решения приняты исполнителем в рамках разрешения продолжать самостоятельно и консервативно. Они не являются новым разрешением на изменение поведения, deployment или использование production-аккаунтов.

## Порядок выполнения

1. Сохранить полезные исходные изменения отдельно, создать локальные ветви и зафиксировать спецификации.
2. Построить настоящий координатор тестов, DEM-oracles, безопасные disposable backend/browser/native fixtures.
3. Воспроизвести D16/D17/D18 и исправить только отдельно разрешённые дефекты с регрессиями.
4. Выполнять независимые пакеты в отдельных worktree; основной агент интегрирует и последовательно запускает bounded проверки.
5. Проверять каждый нетривиальный пакет независимыми correctness/security и maintainability reviews. Статический PASS не заменяет выполнение тестов.
6. Зафиксировать полный source audit, тестпланы и конкретное решение по каждому кандидату; отклонить изменения без доказанной эквивалентности.
7. Выполнить настоящие две native-сессии, отдельную проверенную очистку, финальные проверки исходников, коммиты и cleanup собственных worktree. Не выполнять push.

## C1. Пофайловое решение и runtime evidence различаются

Общий список содержит 761 source-модуль: 329 desktop и 432 web. В каждом `source-audit.json` есть контракт, testPlan, SHA и resolution. Рекомендация reviewer не преобразуется в автоматическое runtime acceptance. `--require-accepted` проверяет наличие source-disposition/evidence, а не выполнение всех сценариев.

749 snapshot-файлов прочитаны семью независимыми направлениями. Одиннадцать новых native QA-модулей и один GPU output driver рассмотрены отдельно. Поздние изменения имеют scoped evidence; исходный SHA не переписан как будто reviewer видел новую версию.

## C2. Не дробить владельцев состояния ради размера файла

Сохранены конкретные владельцы observer events, playback/voice, user activation и durable subscription journal. UserSession остаётся concrete composition owner рядом с services; ложное утверждение «все services знают только ports» удалено вместо создания новой цепочки фасадов.

Replay2d/Canvas сохраняют существующие seams и lifetime. Legal/quota/support/crash сохраняют transaction, account/ticket lock, commit-before-publish и cleanup ownership. Условные большие извлечения закрыты явным retain с индивидуальной причиной, а не считаются незавершённым обязательным переписыванием.

## C3. Применять только оправданные локальные изменения

Перенесён codec без legacy shim, устранено клонирование семи metadata vectors, вынесены unchanged HTTP helpers и private projection math. Удалён identical-branch formatter. Пять security/state-sensitive Rust-файлов форматируются без изменения логики; source witness точно воспроизводит pinned rustfmt. Alembic AST, включая docstrings и model imports, совпадает.

Дублированный SQL eligibility predicate сохранён локально: общий interpolated fragment усложняет bind-arity и контекст запросов без показанной пользы. Auth reactive anchor не удаляется как «невидимая разметка» без доказательства scheduling equivalence.

## C4. Не превращать шум в разрешение менять картинку

Sidebar extraction отклонён и production-файл восстановлен. 720 точных DOM checkpoints не перекрывают семь необъяснённых PNG differences. Нет новых masks, tolerance, blur или min/max-envelope.

W7 принят только как private pure extraction: frozen old/new command oracle и двенадцать точных непустых аппаратных RGBA captures защищают конечные состояния. Whole-home timing не доказал ускорения выше repeat noise. Bloom, DPR, shaders, timing и оформление не сокращаются ради результата. Данные физического телефона не подменяются desktop viewport emulation.

## C5. Новые баги остаются отдельной очередью

Source findings про old-pawn deletion, live keybind acknowledgement, zero-volume reload, token identity, newer draft clearing, stale image errors и другие текущие ошибки не исправляются под видом refactor. Их источник и ограничения доказательства сохранены в audit/source-audit; source trace не называется выполненной регрессией.

Исключения — только ранее разрешённые D16, D17 и D18. Неустановленный отказ native `import_confirm` в одном запуске также не объявлен исправленным благодаря последующему PASS.

## C6. Native QA не ослабляет production trust

До эффектов нужны проверенные fixture ownership и точные binary/config hashes. Используются настоящие TLS и Ed25519, собственные credentials/data/WebView, sandboxed locator и launcher. Оба CS2-порта изолируются до login, поскольку login сам активирует playback. Включение inspector ограничено точным owned-loopback режимом; elevated WebView получает те же разрешённые flags программно.

Metadata-only link inspection не ослабляет exclusive owner lock. Quiescence повторяет только временные Windows sharing/lock ошибки в конечном окне и удерживает все handles после успеха. Cleanup выполняется после закрытия родительского Job; stale/foreign locks не удаляются силой. Две реальные сессии и cleanup зафиксированы отдельно от unit suites.

## C7. Честные ограничения итогового результата

Не заявляется исполнение каждого предложенного теста, принятие всей глобальной visual matrix, слышимость audio или реальный Steam/CS2. Физические iOS/Android и ручные hardware gates остаются согласованными внешними проверками; deployment/push запрещены этой задачей.

Исторические fixed-output browser scripts и radar hybrid/tolerant benchmark не используются как acceptance. Полезные старые reports/screenshots сохраняются; raw traces и временные failures не добавляются в Git. Task-owned worktree удаляются после verified escrow, чужой locked worktree остаётся нетронутым.
