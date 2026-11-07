# План независимых работ

Статус: весь план с последовательными gates утверждён пользователем (D24). Новые исключения поведения требуют отдельных решений.

Эта матрица задаёт обязательства, а не утверждает прохождение проверок. Новые baseline, DOM, visual и native gates пока не выполнены. «Существующие проверки» — найденные тесты; фактические результаты перечислены в REFACTOR-SPEC.md. Для каждого изменяемого модуля сначала фиксируется текущее поведение. Неизменяемые модули также получают явный статус в итоговом реестре.

Продуктовые исключения согласовываются отдельно: D16 — desktop wipe_all; D17 — атомарность одноразовых auth-токенов при подтверждении гонки; D18 — безопасная публикация файлов релизов при подтверждении повреждения. Два последних решения относятся только к watchdemo-web. Остальные исправления поведения в предложениях ниже не разрешены. Точные решения и ограничения находятся в REFACTOR-SPEC.md.

## Утверждённая последовательность (D24)

1. Отдельно сохранить полезные существующие QA-исходники и связанные historical evidence; создать локальную ветку `refactor/behavior-preserving-audit`. Новые документы задачи не смешивать с историческими утверждениями о проверках.
2. W0 — сначала guards disposable DB/origin, collection и output isolation; negative tests должны доказывать отсутствие соединения при reject. Не изменять production Compose, defaults, зависимости или runtime-политику.
3. После safety gates параллельно в разных worktree: W1 frontend/mounted/visual baseline и W2 backend/bot/mail contracts. Тяжёлые проверки выполняются последовательно. Создать проверяемый реестр executable source files → module → disposition/commands/oracle/status; unmapped файлы не считать покрытыми.
4. Снять whole-home baseline и повторные frames/traces. Применить D21 к visual noise и D23 к performance comparisons. Diagnostic suppression компонентов не переносить в продукт.
5. После затронутых baseline gates выполнить обоснованные W3/W6/W7/W8: transport-local helpers, локальное владение frontend helpers, декомпозиция graphics без изменения выхода, доказанные dead exports и комментарии. Каждый перенос должен уменьшать фактическую связанность; universal abstractions не вводить.
6. W4/W5/W9 — legal/quota/bot/mail организация только там, где конкретное извлечение уменьшает reader state и сохраняет все locks/commits/clock/delivery contracts. Иначе явный disposition «проверено; оставить production-код без изменения».
7. D17 и D18 — отдельные concurrent/failure reproducers и при подтверждении отдельные исправления/коммиты. Другие продуктовые баги, CSS accessibility и deployment ingress не изменять без нового решения.
8. Измеренные эквивалентные оптимизации применять по одной с полностраничным повторным сравнением. Parameter simplification допускается только после пользовательского подтверждения D10; отсутствие доказанного выигрыша — основание не сохранять вмешательство.
9. Последовательная интеграция, cross-boundary проверки, независимые correctness/quality reviews, локальные финальные коммиты без push. Новые traces/video/temporary services/worktrees удалить после разбора; versioned эталоны и исторические материалы сохранить. Физические телефоны остаются deferred по D06.

Утверждение последовательности разрешает проходить согласованные gates без повторного разрешения на каждый модуль. Новые поведенческие исправления, визуальные упрощения и любые production/неизолированные действия остаются отдельными решениями.

## Recommendation

### Этап 0. Единый контракт проверки

До движения production-кода:

1. Зафиксировать полезную исходную работу отдельным baseline-коммитом.
2. Создать локальную ветку задачи.
3. Описать три явно различающихся режима проверки:
   - `pure`: фиктивные настройки, запрет внешних соединений;
   - `mock-browser`: реальное UI, mock API, запрет внешних browser/request обращений;
   - `isolated-backend`: реальные временные сервисы по точному allowlist.
4. Исправить безопасность самих QA/DB fixtures до запуска опасных сценариев.
5. Записать среду визуальных эталонов: commit, browser/build, ОС, viewport, DPR, locale, шрифты, motion/transparency, fixture identity, фиксированное время анимации.
6. Составить machine-readable или проверяемый реестр модулей. У каждой строки должны быть owner workpack, команды, эталоны и статус `baseline captured / blocked / unchanged`.

Общий bootstrap проверки полезен. Общий «магический runner всего» с неявным выбором production/mock режима не нужен.

### Обязательные инварианты

Сохранять без изменений:

- различия credential revision, auth transition, activation и same-session rotation;
- очередь cookie-changing запросов;
- unknown-outcome barriers group reset;
- lock order, clock sampling, immutable timestamps, generation и tombstones quota;
- текущие transaction/send/cache-write boundaries;
- legal evidence и immutable publication history;
- retry/ack/delivery semantics mail и bot;
- единственный animation clock;
- CSS import order и фактическое мобильное стекло до отдельного согласования;
- формат файлов, ответы API, коды ошибок, nullable/omitted различия;
- historical migrations, legal revisions, previews, fixtures и attribution.

### Допустимые точные структурные работы

| Работа | Конкретная граница | Условие |
|---|---|---|
| HTTP helper extraction | Перенести неизменённые cookie helpers из auth views и input/image helpers из public support views в transport-local модули | Snapshot HTTP/cookie/error поведения. Не переносить FastAPI types в domain |
| Pure policy extraction | Staff target rules, support time/state predicates, crash fingerprint normalization | Сохранять порядок проверок, clock inputs и exact errors |
| Legal decomposition | Разделить manifest acquisition, activation/evidence persistence и outbox orchestration | Один owner legal-модуля. Те же locks, transaction scopes, batch commits и identities |
| Artifact storage extraction | Release, symbols и support storage вынести за узкие существующие use-case границы | Сначала сохранить пути, I/O order, ошибки и cleanup. Atomic publication и race fixes отдельно |
| Quota readability | Выделить построение snapshot из переходов ledger | Не менять SQL/lock order, session refresh, время выборки clock или batch semantics |
| Renderer organization | Из `GhostFibers.tsx` выделить реально самостоятельные shader/resources/pass/input части | Те же constants, allocation order, seeds, matrices, pass graph и shared clock |
| Home/radar organization | Чистые frame/interpolation/projection helpers отделить от React lifecycle | Не менять idle drift, seek timing, trails, DPR policy и offscreen lifecycle |
| CSS ownership documentation | Указать owning stylesheet и удалить ложные комментарии | Сначала без перемещения правил. Затем переносить только с computed-style и pixel parity |
| Dead helpers | Проверить и удалить `isTouch`/`isMobile`, если полный caller/export search подтверждает отсутствие использования | Проверить scripts, previews, SSR и package entrypoints |
| Comment cleanup | Удалять пересказ синтаксиса, неверные lifecycle/preload обещания, дубли | Сохранять причины locks/retries/compatibility, лицензии и эксплуатационные ограничения |

Предлагаемый локальный target tree, **не обязательная новая иерархия**:

```text
web/API/http/
  auth_cookies.py
  support_inputs.py

web/APP/services/legal/
  catalog_transport.py
  activation.py
  evidence.py
  outbox.py

frontend/src/features/backgrounds/GhostFibers/
  GhostFibers.tsx
  shaders.ts
  resources.ts
  passes.ts
  interaction.ts
```

`legal_service.py` может остаться содержательным use-case orchestrator. Не создавать пустые compatibility wrappers. Мигрировать внутренних callers в том же workpack. Остальной layout репозитория сохранять, пока конкретный перенос не уменьшает связанность.

## Workpacks and ownership

All mutations require separate worktrees. Do not run resource-heavy checks concurrently merely because writers are isolated.

| Workpack | Exclusive paths | Parallelism and gate |
|---|---|---|
| W0 Safety/test bootstrap | `docs/scripts/` safety helpers, test fixture containment, frontend QA bootstrap | First. One coordinator owner. Reject arbitrary DB/origin before connection. Review independently |
| W1 Frontend baseline | New frontend checks/browser fixtures/visual baselines | After W0. Establish current UI/known-defect registry; no production changes |
| W2 Backend/bot/mail baseline | Test-only additions and golden envelopes | Parallel with W1 after W0, but serial execution of heavy checks |
| W3 HTTP/pure-policy extraction | `web/API/http/`, exact caller views, selected small policy modules | After affected W2 gates. No settings/dependencies/legal/quota shared edits |
| W4 Legal decomposition | `legal_service.py`, proposed legal submodules and legal tests | One owner. No simultaneous changes to legal ORM/migrations/periodic wiring |
| W5 Quota readability | Quota service internals and corresponding tests | One owner, after PostgreSQL oracle. Do not concurrently touch quota repository/model/clock contract |
| W6 Frontend local organization | Non-graphics helper ownership, proven dead exports, exact affected callers | After W1. Exclude shared hooks/auth fixes and global CSS until separately approved |
| W7 Graphics organization/performance | `features/backgrounds/`, home/radar assigned files | One graphics integration owner. Baseline before movement; whole-page trace before optimization. Do not split two writers across shared clock/style hotspots |
| W8 CSS/comment cleanup | Exact CSS/comment-only file list | After relevant behavioral changes settle. No broad reformat, import reordering or unmeasured removal of blur |
| W9 Bot/mail organization | Each service independently, tests/envelopes included | Only source-proven simplifications. Current modules may warrant no structural change |
| W10 Integration | `dependencies.py`, global settings, router registry, manifests, shared scripts | Parent-owned. Integrate sequentially, rerun cross-boundary gates and thermos |

W3/W4/W5 need not all be implemented merely because they are possible. Each proposed extraction must remove an actual dependency or reduce reader state. “No justified change” is a valid module result.

### Graphics sequence

1. Capture current whole-home traces, fixed-time frames and environment metadata.
2. Attribute CPU scripting, Canvas draw, WebGL passes, paint/compositing and allocation cost.
3. Use component suppression only inside diagnostic harnesses to identify attribution.
4. Perform organization-only extraction with identical output.
5. Apply one measured equivalent optimization per comparison.
6. Check full-home output and timing again, including hidden/visible and scroll re-entry.
7. For any parameter reduction, present before/after comparison and await user approval.
8. Record physical-phone validation as deferred, not passed.

No blind DPR reduction,30FPS cap, removal of idle drift, flattened glass, reduced bloom/thread counts or resident-offscreen renderer should enter the default optimization workpack.
