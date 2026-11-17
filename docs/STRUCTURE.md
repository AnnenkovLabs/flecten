# Структура

Один файл отвечает за одну вещь. Мягкий предел 300 строк, жёсткий 500. Домен группирует концепты; файл делят по ответственности.

## Локализация

`ui/src/lib/i18n.svelte.ts` хранит выбранный язык и подставляет данные в переводы. `ui/src/lib/i18n/locales.ts` задаёт семь языков и английский по умолчанию. Каталоги разделены по областям интерфейса в `ui/src/lib/i18n/messages/`. `shell/dialog-copy.mjs` содержит подписи системного окна закрытия. Сайт использует `web/i18n.js` и `web/locales/`, переводы README находятся в `docs/i18n/`.

## Backend

| Путь | Ответственность |
|---|---|
| `src/app/server.ts`, `server-handlers.ts` | sidecar JSONL protocol, проверка команд и ответы |
| `shared/storage-migration.ts`, `src/app/storage-bootstrap.ts`, `src/store/storage-migration/` | обязательный startup gate, typed progress, проверенные оригиналы, resumable публикация и отдельное принятие |
| `ui/src/components/StorageMigration.svelte`, `ui/src/lib/run/storage-migration.svelte.ts` | незакрываемый экран обновления, повтор после ошибки и ожидание настоящего runtime status |
| `shared/twin*.ts`, `src/twin/`, `src/app/twin.ts`, `twin-handlers.ts`, `conversation-twin.ts`, `twin-question.ts` | отдельная персона, источники, обучение, направление Worker, приёмка, ответы от лица пользователя и typed dialogue; [TWIN.md](TWIN.md) |
| `src/app/service.ts`, `service-types.ts` | сборка зависимостей и публичный API приложения |
| `shared/access-mode.ts`, `src/app/access.ts` | общий каталог режимов доступа, определение custom и проверенное изменение security-полей конфига |
| `src/app/conversation.ts`, `conversation-options.ts`, `worker-tool.ts`, `worker-references.ts` | независимые Talker/Worker, управление, роли, scoped ссылки и события Worker |
| `src/app/conversation-budget.ts`, `single-session.ts`, `twin-accounting.ts`, `src/core/session/run-accounting.ts` | общий durable бюджет чата, учёт основных и вспомогательных запросов и неизвестных receipts |
| `src/app/worker-recovery.ts`, `conversation-restore.ts` | операционное восстановление, handles, неопределённые эффекты и сохранённый частичный результат |
| `src/app/session-pool.ts`, `recovery.ts`, `session-replay.ts` | параллельные задачи, восстановление и история модели |
| `shared/model-choice.ts`, `src/app/session-models.ts`, `session-model-options.ts` | выбор модели, reasoning и варианта отдельно для каждого чата, durable восстановление и согласованные параметры провайдера |
| `src/app/event-journal.ts`, `session-logs.ts` | live replay с курсором и durable запись |
| `src/app/session-history.ts`, `session-export.ts` | retention, корзина и экспорт |
| `shared/message-branches.ts`, `src/store/events/branches.ts`, `src/app/message-branches.ts`, `message-attachments.ts`, `session-pages.ts` | типизированные версии сообщений, выбор сохранённых вложений, append-only выбор ветки, новое продолжение и scoped архив страниц |
| `src/app/extensions.ts`, `extension-runtime.ts`, `extension-handlers.ts` | жизненный цикл MCP/skills и запросы окна |
| `src/app/provider-state.ts`, `provider-ops.ts`, `provider-secrets.ts` | представление провайдеров, проверки, actualize и скрытие секретов |
| `src/app/provider-auto-refresh.ts`, `src/providers/actualize.ts`, `shared/model-draft.ts`, `ui/src/components/ProviderModelRefresh.svelte` | ежечасное обновление метаданных, сохранение ручных правок по baseline, слияние открытого черновика со свежими моделями и настройки каждого провайдера |
| `src/config/` | версии, миграции, Zod-схемы, defaults, единый глобальный desktop profile, scoped secrets, destination binding и атомарная запись |
| `src/core/session/` | канонический lifecycle, бюджет, approvals, запуск, остановка и события |
| `src/core/loop/` | stream, tool batches, continuation, retry и compaction |
| `src/core/loop/external-access.ts`, `tool-authorization.ts` | канонические области внешних папок, общие grants чата, разрешение вызова и обновление logical/OS sandbox |
| `src/core/pages/`, `src/context/` | typed lifecycle страниц Worker, архивный порт, summary, tokenizer, бюджет и pruning |
| `src/tools/context/run.ts`, `src/store/pages.ts` | инструмент begin/complete/list/read/search и durable архив сегментов с восстановлением и копированием |
| `src/core/queue/`, `goal/`, `subagents/` | соответствующие работающие механизмы сессии |
| `shared/hooks.ts`, `src/core/hooks/`, `src/app/hook-test.ts` | общий каталог событий и схемы, matcher/исполнение и проверка черновика; контракт в [HOOKS.md](HOOKS.md) |
| `src/core/subagents/tasks.ts`, `result.ts`, `src/app/subagent-report.ts` | независимый lifecycle детей чата, проверка отчётов и один шаг оформления без рабочих инструментов |
| `src/core/memory/` | main-model инструмент, тематический каталог, пакетное чтение, source authority, схемы, доставка и visibility ревизий |
| `src/app/memory.ts`, `src/store/memory.ts`, `memory-mutations.ts` | общий проектный MemoryPort, CAS, атомарное согласование, metadata cache, audit и legacy migration |
| `shared/dictionary.ts`, `src/dictionary/`, `src/app/dictionary.ts` | схемы определений, публичные категории и синхронизация, распознавание написаний и локальные определения в памяти |
| `src/core/types/` | типы сообщений, событий, инструментов, команд и результата |
| `src/core/attachments.ts`, `media.ts`, `audio-duration.ts`, `image.ts` | content parts, capability validation, сигнатуры изображений и оценка media |
| `src/app/vision.ts`, `src/core/session/vision.ts`, `src/core/loop/vision.ts` | выбор vision-провайдера, описание изображений, бюджет и подготовка контекста незрячей модели |
| `src/skills/` | discovery, trust, каталог, активация, allowed-tools, ресурсы и replay |
| `src/mcp/` | SDK transports, OAuth, health, каталоги, resources/prompts и elicitation |
| `src/connectors/x/` | отдельный HTTP MCP-сервер X для ChatGPT, OAuth bridge, зашифрованные токены и read-only API |
| `src/modules/`, `src/core/modules/`, `src/app/modules.ts` | SDK/MCP пакеты, session/project platform, hot-load, зависимости, trust и append-only контекст |
| `src/modules/marketplace.ts`, `marketplace-download.ts`, `shared/module-marketplace.ts` | встроенный и HTTPS-каталоги, проверка пакетов, зависимости и протокол маркетплейса |
| `src/marketplace/index.json` | пустой встроенный каталог, включённый в бинарник без сетевого обновления |
| `src/core/services/`, `src/app/session-storage.ts` | replace/wrap/provide/require, schema-defined сервисы, leases и единый backend журнала/индекса |
| `src/core/types/event-schema.ts` | общие схемы событий для native drivers и durable read |
| `src/commands/` | пользовательские и проектные slash-команды |
| `src/security/provider-protection.ts`, `src/security/provider-secrets/`, `shared/provider-protection.ts` | защита выбранных провайдеров, обратимые теги секретов и ограниченные проверки ответов; [описание](PROVIDER-PROTECTION.md) |
| `src/providers/gateway-detection.ts`, `gateway-signals.ts` | ограниченная проверка публичных признаков New API / One API без учётных данных |
| `src/providers/` | четыре адаптера, HTTP/SSE, auth, каталог, probe, discovery и failover |
| `src/providers/model-metadata.ts`, `ui/src/lib/settings/model-metadata.ts` | получение характеристик из API и каталога, добавление и обновление черновика модели без генерации |
| `src/providers/model-identity.ts` | сопоставление ID, canonical aliases и производных uncensored/abliterated; версия и checkpoint сохраняются, API endpoint имеет приоритет |
| `src/translation/`, `src/app/translation.ts` | перевод текстовых узлов, кэш, рабочий язык сессии, локализованный поток и выбранный провайдер |
| `src/tools/` | реестр, repair, budgets, logs и встроенные инструменты |
| `src/tools/catalog.ts`, `registry.ts` | явная активация MCP schemas в сессии и восстановление из успешных вызовов и checkpoint |
| `src/tools/jobs/remote.ts`, `remote-runner.py`, `ssh-capability.ts` | durable remote jobs, идентичность процесса, reconnect и ограниченная SSH capability |
| `src/tools/util/scratch.ts`, `src/security/session-grant.ts` | постоянный scratch чата и точные grants с владельцем и ревизией политики |
| `src/tools/grep/line-matcher.ts`, `glob/gitignore.ts`, `read/run.ts` | прерываемый regex worker, вложенные ignore scopes и bounded чтение |
| `src/terminal/` | PTY, jobs, process tree, ограничения ресурсов |
| `src/terminal/command-completion.ts` | явный статус команды выбранной оболочки, frame с nonce/exit code и целым окончанием строки |
| `src/terminal/process-scope.ts`, `native-processes.ts`, `windows-processes.ts` | наследуемая идентичность Linux-процессов, POSIX process/socket metrics и schema-validated Windows CIM snapshots |
| `src/security/` | permissions, trust, sandbox, protected paths, secret backends |
| `src/security/shell-paths.ts`, `src/tools/util/mutation-path.ts` | ресурсы shell через существующий lexer и повторная проверка путей файловых изменений |
| `src/store/` | durable events, queue, pages, память и checkpoints |
| `src/util/abort.ts`, `mutex.ts`, `atomic.ts` | отменяемое ожидание IO, сериализация и атомарная публикация с deadline |
| `src/observability/` | bounded structured logs, counters, trace, crash report, diagnostics и opt-in telemetry |
| `src/util/`, `src/errors/` | общие чистые функции и типы ошибок |

## Окно и интерфейс

| Путь | Ответственность |
|---|---|
| `shell/main.mjs` | Electron lifecycle, окно и запуск sidecar |
| `shared/project-index.cjs`, `shell/projects.mjs`, `src/app/project-list.ts`, `project-trust.ts` | сохранённые папки, каноническое доверие, выбор рабочей папки и общий список сессий |
| `shell/preload.cjs`, `agent-commands.json` | проверенный IPC bridge и allowlist команд |
| `shell/deep-links.mjs`, `window-state.mjs` | выбор существующей задачи по URL и restore bounds |
| `shell/updater.mjs` | signed update loop: фоновые проверки, автозагрузка, установка по кнопке или при выходе |
| `shell/github-update-provider.mjs` | источник GitHub Releases: самый свежий опубликованный релиз, подписанный manifest из assets |
| `shell/update-runtime.mjs` | экземпляр updater в оболочке: feed, настройки из status, IPC |
| `shell/update-policy.mjs`, `shared/update-settings.cjs` | политика фида, канала и расписания; общая нормализация настроек обновления для sidecar и оболочки |
| `ui/src/App.svelte` | композиция экрана и горячие клавиши |
| `ui/src/components/ProjectNavigation.svelte`, `ProjectTrust.svelte`, `ProjectGroup.svelte`, `ui/src/lib/run/projects.svelte.ts` | проекты и сессии, контекстное меню папки и запрос доверия при входе |
| `ui/src/app.css` | единственные токены, шрифт и базовые стили |
| `ui/src/lib/interface-scale.svelte.ts`, `components/settings/InterfaceScale.svelte` | масштаб интерфейса 75–125%, сохранённый в профиле окна; preload применяет native zoom ко всему layout, включая чат и композер |
| `ui/src/controls.css` | общие кнопки, поля и переключатели всех поверхностей |
| `ui/src/custom-controls.css`, `ui/src/components/controls/`, `ui/src/lib/tooltip.ts` | оформление checkbox, slider и progress; общие select/combobox и подсказки через существующий floating layer |
| `ui/src/lib/modal.ts`, `clipboard.svelte.ts` | единый lifecycle модальных окон и подтверждённое копирование |
| `ui/src/lib/run.svelte.ts`, `run/` | проекция канонических событий и ответов для экрана |
| `ui/src/lib/run/model.ts` | выбор модели текущего чата, отдельные общие defaults и сериализация изменений без отката от чужого статуса |
| `ui/src/lib/run/message-history.svelte.ts`, `composer/drafts.svelte.ts`, `composer/attachment-draft.ts` | режим редактирования в основном композере, отдельный черновик и асинхронные вложения своего сообщения |
| `ui/src/lib/composer/draft-storage.ts` | проверенные записи черновиков в профиле окна, ограниченная частота записи, сохранение при уходе и восстановление фокуса чата |
| `ui/src/lib/updater.svelte.ts` | единый live-статус обновлений для чипа заголовка и карточки в настройках |
| `ui/src/lib/tool-presentation.ts`, `subagent-report.ts` | понятные названия и состояния вызовов, проверка и представление отчётов субагентов |
| `ui/src/lib/run/subagents.svelte.ts`, `SubagentPane.svelte`, `SubagentAvatar.svelte` | отдельные вкладки, live журнал, остановка и согласованные персонажи субагентов |
| `ui/src/lib/agent-protocol.ts`, `types.ts` | контракт моста и типы представления |
| `ui/src/lib/settings.svelte.ts`, `settings/` | проверенный черновик настроек, проверки провайдера и diff |
| `ui/src/lib/settings/modules.svelte.ts`, `components/settings/ModuleMarketplace.svelte`, `InstalledModules.svelte` | поиск и установка модулей, каталоги и управление установленными пакетами |
| `ui/src/lib/ide.svelte.ts`, `ide/` | редактор, вкладки, syntax tree, выделение и сохранение через sidecar |
| `ui/src/lib/thread-*` | окно сообщений, измерение высот и позиция чтения |
| `ui/src/components/` | Svelte 5 компоненты с props и состоянием из lib |
| `ui/src/components/settings/` | формы, trust, MCP, hooks, skills, modules и diagnostics |
| `ui/src/components/permissions/`, `settings/PermissionsSettings.svelte`, `settings/SandboxSettings.svelte` | единый Access: режимы, запросы доступа, сохранённые правила, human checkpoints и раскрываемая изоляция |
| `ui/src/components/ApprovalDock.svelte`, `ApprovalCard.svelte` | ожидающие решения над композером в чате и IDE, видимые кнопки ответа и receipts в истории |
| `ui/src/components/ide/` | файлы, CodeMirror и diff |

`shared/session-state.ts` задаёт единую проверяемую схему lifecycle snapshots для backend и renderer.

## Промпты, инструменты разработки и доказательства

- `prompts/`: Markdown системного промпта, capability sections, роли и completion contract; `memory.md`, `memory-checkpoint.md`, `tool-description-memory.md` задают семантический контракт памяти.
- `scripts/`: сборки, project rules, docs as code, coverage, performance, package/smoke и release helpers.
- `bench/`: 20 deterministic задач, mock provider, runner, Codex CLI adapter и отчёты.
- `tests/unit/`, `tests/integration/`, `tests/smoke.test.ts`: настоящий сервис и адаптеры с локальными фикстурами.
- `tests/e2e/`: скрытый Electron с mock provider, сценарии и visual regression на 1480x940 и 1180x640.
- `tests/fixtures/modules/`: прежние пакеты как тестовые примеры SDK, без поставки в приложении; `computer-use/` проверяет Linux Computer Use, управление сессией, private display backend, bounded AT-SPI, инструкции и Computer surface. Продуктовый путь проверяет `tests/integration/computer-use.test.ts`.
- `.github/workflows/`: reusable quality, coverage text/LCOV, Electron visual regression, platform packaged smoke, packaging/signing и диагностика.
- `docs/`: архитектура, решения, протокол, безопасность и приёмка; `docs/research/access-ux-2026-11-14.md` фиксирует версии и исходники сравнения permissions UX.

`docs/MEMORY.md` описывает действующий memory runtime и бюджеты. Внутренние материалы связывают решение с чужими исходниками и эксплуатационными отказами. `src/tools/memory/run.ts` предоставляет инструмент, а checkpoint использует существующий `src/core/pages/writer.ts` без отдельного запроса модели.

## Поток данных

1. Electron запускает agent в выбранном проекте или в служебной папке профиля без проекта. Sidecar получает lock рабочего хранилища.
2. `app` загружает конфиг, секреты, инструкции и расширения; строит registry и session pool.
3. Renderer отправляет проверенную команду через preload. Он не читает файлы и не вызывает модель.
4. Core session управляет прогоном, queue, approvals и tools; выводит типизированные события.
5. App применяет redaction, durable запись и live journal. UI получает события с идентичностью сессии и последовательностью.
6. `run.svelte.ts` строит представление; после IPC применяет канонические ответы. Переоткрытие использует журнал, replay и статус backend.

## Границы

- `core` не импортирует `ui`, `shell`, `store`. Персистентность передаётся через API и callbacks.
- `ui` не импортирует `core`, `store`, `tools`. Компоненты получают props и функции из `ui/src/lib`.
- `shell` отвечает за OS и transport, не за логику харнесса.
- `providers` переводит стандартные model messages и tools в протокол провайдера.
- `tools` проверяет схему, permissions и пути до выполнения; вывод считается недоверенными данными.
- `app` соединяет домены. Новая ответственность получает отдельный модуль, не ещё один блок в service.ts.

Базовые действия IDE: `workspace-files.ts` проверяет файловые операции, `workspace-search.ts` ищет по файлам, `workspace-replace.ts` применяет проверенный план замены, `workspace-git.ts` управляет Git, `ide-terminal.ts` владеет пользовательской PTY. В renderer `ide/commands.ts` задаёт команды и shortcuts, `layout.svelte.ts` хранит предпочтения, `search.svelte.ts` проверяет поиск и замену, `git.svelte.ts` хранит Git-представление. Компоненты IDE получают workspace через props и не обращаются к файловой системе.

Talker/Worker отображаются через `ui/src/lib/run/worker.svelte.ts`, `markdown/tool-references.ts`, `WorkerPane.svelte` и `MirroredMarkdown.svelte`. Оба используют `ThreadView` и `Thread.svelte` для сообщений, рассуждений, действий и live-статуса. Композер остаётся только в диалоге Talker.

Twin UI: `ui/src/components/twin/`, `ui/src/lib/twin.svelte.ts` и `ui/src/lib/run/twin-view.svelte.ts` показывают источники, характер, обучение и реплики. `ui/src/lib/twin/` разделяет rig, lifecycle интерактивной сцены и WebGL2-рендер исходной 3D-геометрии и шерсти трейлера. Канонический shader находится там же; `scripts/twin/render-assets.mjs` создаёт из него fallback в `ui/public/twin/`.
