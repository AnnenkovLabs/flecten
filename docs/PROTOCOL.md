# Протокол

## Сервис

Ядро отдаёт один интерфейс:

```ts
interface HarnessService {
  send(command: Command): Promise<unknown>;
  subscribe(listener: (event: Event) => void): () => void;
}
```

Всё остальное это адаптеры: sidecar для Electron и прямой вызов в тестах. Полный список команд sidecar лежит в `shell/agent-commands.json`, события ядра описывает тип `Event` в `src/core/types/event.ts`. `bun scripts/docs-check.mjs` сверяет этот документ с обоими в обе стороны: команда или событие без строки в таблице и строка без команды или события валят CI.

## Транспорт

Electron запускает `dist/flecten-agent` (или `src/app/server.ts` в dev) и общается JSON-строками: одна строка, один объект.

- Команды идут в stdin, события и ответы в stdout, диагностика в stderr.
- Любая команда может нести `requestId` (строку). Тогда результат приходит ответом `response` с тем же `requestId`: `ok: true` и поля из колонки «Ответ» или `ok: false` и `error`.
- Без `requestId` ответа нет, а ошибка приходит событием `error` с кодом `invalid_input`.
- `run` и `hello` возвращают результат событиями (`session.started` и дальше, `status`). `stop` с `requestId` также подтверждает команду и возвращает канонический state.
- Текст ошибок проходит через `redact`: ключи и токены не попадают в окно и логи.

```json
{ "type": "checkpoint.list", "requestId": "r7", "sessionId": "s_1" }
```

```json
{ "type": "response", "requestId": "r7", "ok": true, "checkpoints": [] }
```

```json
{ "type": "response", "requestId": "r8", "ok": false, "error": "id is required" }
```

Один проект обслуживает одно ядро. На старте ядро берёт замок `.liquid/sidecar.lock` (pid, токен, время старта; файл появляется целиком через hard link). Замок живого ядра ждут до 5 с: так переоткрытый проект дожидается, пока прошлое ядро закончит запись. Замок мёртвого процесса забирают сразу. Если за 5 с замок не освободился, ядро пишет `error` с кодом `project_locked` и выходит, окно не перезапускает его по кругу. В папке только для чтения ядро работает без замка.

Оболочка проверяет команду до того, как отдать её ядру: объект, `type` из `shell/agent-commands.json`, `requestId` строкой, `prompt` до 200 000 символов, вся строка до 4 МиБ. Ядро ещё раз проверяет каждое поле на своей границе (`src/app/server-input.ts`): `text` и `prompt` до 200 000 символов, идентификаторы, числа и списки по типу.

## Задачи и маршрутизация

Одновременно идут несколько задач, предел задаёт `sessions.maxConcurrent` (по умолчанию 4). Каждая задача это отдельная сессия со своей очередью, подтверждениями, фоновыми задачами и бюджетом.

- Команды с колонкой «Задача: да» принимают `sessionId`. Без него команда идёт в задачу в фокусе.
- `approval.respond`, `approval.allowAll` и `approval.denyAll` без `sessionId` находят задачу по `id` подтверждения: ответ из любого окна попадает в ту задачу, которая спросила.
- Каждое событие задачи несёт `sessionId`. Уведомление о фоновой задаче доходит только до той задачи, которая её запустила.
- Второй `run` в задачу, которая уже идёт, отклоняется (`a run is already active`). Сообщение в идущую задачу отправляют через `steer` или `queue.add`.

## Порядок событий и повтор

При включённом переводе `session.started.prompt` сохраняет исходное сообщение слово в слово. `input.translated` несёт английский `input`, язык пользователя в `language` и stamp фактического системного префикса в `system`. `message.finished` хранит оригинальные английские `text`, `reasoning`, `summary`; отдельный `display` содержит перевод для окна. Аналогично `context.compacted.displaySummary` отделён от канонического `summary`. Replay модели использует оригиналы, renderer использует display. Ошибка обратного перевода сохраняется как `translation.failed` и показывает оригинал. События `usage` с `purpose: translation` несут провайдера, модель и `durationMs`; бюджет учитывает отдельный тариф переводчика. Аналогично `purpose: vision` обозначает описание изображения отдельной моделью и использует её тариф.

- Sidecar нумерует каждое событие полем `seq`. Номер растёт на весь процесс, общий для всех задач.
- События одной задачи идут по порядку. `tool.finished` приходит в порядке завершения, а результаты попадают в историю модели в порядке вызова.
- `events.replay` возвращает события текущего (или последнего) запуска задачи от его `session.started`: `{ "replay": { "sessionId", "events", "seq", "running" } }`. Дельты завершённого сообщения в повтор не входят: `message.finished` несёт тот же текст.
- Окно после перезагрузки или второе окно применяет `events`, а затем пропускает живые события с `seq` не больше `replay.seq`. Так ни одна дельта не теряется и не приходит дважды.
- В памяти хранятся последние 32 задачи, до 20 000 событий на запуск. Полная история задачи на диске, её отдаёт `sessions.get`.

```json
{ "type": "events.replay", "requestId": "r9", "sessionId": "s_1" }
```

## Команды

| Команда | Задача | Поля | Ответ |
|---|---|---|---|
| `twin.get` | нет | нет | `twin`: профиль, источники и состояние обучения |
| `twin.scan` | нет | нет | `twin`: реальные пути и количества сессий |
| `twin.train` | `sourceIds` | нет | `twin`: немедленный snapshot, обучение в фоне |
| `twin.cancel` | нет | нет | `twin`: отмена обучения |
| `twin.configure` | `enabled?`, `sourceIds?` | нет | `twin`: настройки представителя |
| `twin.review` | `candidateId`, `action`, `edits?` | нет | `twin`: применение старого предложения |
| `twin.update` | `id`, `expectedRevision`, `edits` | нет | `twin`: CAS правка характера |
| `twin.forget` | `id`, `expectedRevision` | нет | `twin`: удаление черты |
| `twin.teach` | `summary`, `content`, `appliesWhen`, `path?`, `before?`, `after?`, `reaction?`, `strength?`, `voice?` | нет | `twin`: явный урок без модели |
| `twin.consult` | `question` | нет | `twin`, `answer`: пробная реплика с основаниями и usage |
| `dictionary.list` | нет | нет | `dictionary`, публичные и локальные определения с источником и ревизией |
| `dictionary.sync` | нет | нет | `dictionary`, проверенный снимок GitHub или предыдущие определения с ошибкой обновления |
| `dictionary.save` | нет | `entry`, `expectedRevision?` | `dictionary`, локальное определение, сохранённое в памяти проекта |
| `dictionary.forget` | нет | `id`, `expectedRevision` | `dictionary`, удаление локального определения; публичное снова становится доступным |
| `sessions.export` | нет | `id` | `exported.path`, копия JSONL истории в `.liquid/exports/` |
| `context.pull-request` | нет | `url` | `contextReference`, описание публичного GitHub PR |
| `diagnostics.export` | нет | нет | `diagnostics.path`, `diagnostics.report` |
| `telemetry.send` | нет | нет | отправка счётчиков только при сохранённом consent |
| `hooks.test` | нет | `event`, `index` | `hookTest`, результат сохранённого хука |
| `modules.list` | опционально | `sessionId?` | `moduleState`, каталог, активные версии и поверхности |
| `modules.marketplace` | нет | `action: list/install/addSource/removeSource`, `refresh?`, `url?`, `source?`, `name?`, `revision?` | `moduleMarketplace`, `moduleState`; поиск каталога, подключение источников и установка проверенных пакетов с зависимостями |
| `modules.change` | нет | `operation`, `path`, `revision?`, `enabled?` | `moduleState`, install/trust/enable/development/interface/remove |
| `modules.surface` | опционально | `name`, `surface`, `revision` | `moduleHtml`, проверенная HTML-поверхность |
| `modules.invoke` | да | `name`, `surface`, `revision`, `request` | `moduleResult`, вызов через общий tool executor |
| `modules.styles` | нет | `name`, `revision` | `moduleStyles`, CSS выбранного интерфейса |
| `modules.authorize` | опционально | `name`, `surface`, `revision`, `request` | `moduleAuthorized`, проверка прав поверхности на API харнесса |
| `skills.list` | нет | нет | `skills`, метаданные и файлы ресурсов |
| `skills.reload` | нет | нет | `skills`, перечитанный каталог |
| `skills.resource` | нет | `name`, `path` | ограниченный текст ресурса навыка |
| `mcp.status` | нет | нет | `mcp`, health, logs, catalogs, запросы авторизации |
| `mcp.reconnect` | нет | `id?` | `mcp`, пересобранный каталог |
| `mcp.resource` | нет | `server`, `uri` | `attachedContext`, текст и бюджет ресурса |
| `mcp.prompt` | нет | `server`, `name`, `args?` | `attachedContext`, готовый prompt сервера |
| `mcp.oauth.start` | нет | `id` | `authorization`, URL согласия, ключи остаются в sidecar |
| `mcp.oauth.cancel` | нет | `id` | отмена авторизации |
| `mcp.elicitation.respond` | нет | `id`, `response` | `answered`, валидация ответа по форме сервера |
| `hello` | нет | нет | без ответа, sidecar присылает `status` |
| `status` | да | `sessionId?` | с `sessionId`: `state` задачи; затем `status` |
| `run` | да | `prompt`, `reasoning?`, `sessionId?`, `clientId?`, `attachments?`, `contexts?`, `resumed?` | без ответа, дальше события задачи |
| `stop` | да | `sessionId?`, `mode?: graceful / force`, `target?: worker` | `result`, `state`; задача завершается `session.finished` |
| `steer` | да | `text`, `attachments?`, `contexts?`, `id?` | `result`; сообщение уходит в текущий ход (`steer.applied`) |
| `queue.add` | да | `text`, `attachments?`, `contexts?`, `id?` | `result`; сообщение уйдёт после текущего запуска |
| `queue.edit` | да | `id`, `text` | `result` |
| `queue.remove` | да | `id` | `result` |
| `approval.respond` | да | `id`, `decision` | `result` |
| `approval.allowAll` | да | `ids` | `result` |
| `approval.denyAll` | да | `ids` | `result` |
| `tool.cancel` | да | `callId` | `result` |
| `subagent.stop` | да | `id` | `result.stopped`, `state`; останавливает выбранного субагента, включая субагента Worker |
| `jobs.list` | да | нет | `jobs` |
| `jobs.stop` | да | `id` | `job` |
| `checkpoint.list` | да | нет | `checkpoints` |
| `checkpoint.diff` | да | `id` | `diff` |
| `checkpoint.restore` | да | `id`, `target?`, `paths?`, `force?`, `includeProtected?` | `restore` |
| `context.compact` | да | `focus?` | итог сжатия: `pruned`, `before`, `after`, `summary` |
| `events.replay` | да | `sessionId` | `replay` |
| `sessions.list` | нет | `query?`, `limit?`, `offset?` | `sessions` |
| `sessions.search` | нет | `query`, `limit?`, `offset?` | `sessions` |
| `sessions.get` | нет | `id` | `events` |
| `sessions.rename` | нет | `id`, `title` | `session` |
| `sessions.delete` | нет | `id`, `confirm: true` | итог удаления |
| `sessions.fork` | нет | `id`, `sequence?` или `turn?` | `session` |
| `settings.get` | нет | нет | `settings` |
| `voice.status` | нет | нет | `voice`: engine, providerId, имя провайдера/движка, модель, язык; для локального режима проверяет установку |
| `voice.transcribe` | нет | `id` (UUID), `audio` (base64: до 2 МиБ для API, 2 900 044 байт WAV для локального), `mimeType`, `destination?` (engine, providerId, model, language из voice.status) | `text`: распознанная речь |
| `voice.cancel` | нет | `id` | отмена распознавания или установки и дерева процесса |
| `voice.check` | нет | `id` (UUID), `engine` (faster-whisper или vosk), `local` (python, whisperModel, voskModel, device) | `voiceSetup`: ready, message |
| `voice.prepare` | нет | `id` (UUID), `engine`, `local` | установка движка и загрузка модели, `voiceSetup`: ready, message |
| `settings.save` | нет | `config`, `clearApiKeys?` | `info`; затем `status` |
| `trust.accept` | нет | нет | `info`; затем `status` |
| `model.set` | нет | `provider`, `model`, `reasoning?`, `variant?` | `info`; затем `status` |
| `model.probe` | нет | `provider`, `model` | итог проверки модели |
| `provider.discover` | нет | `protocol`, `baseUrl`, `apiKey?`, `headers?` | `result` |
| `provider.draft` | нет | `provider`, `providerId?` | `result` с токеном черновика |
| `provider.test` | нет | `model` и `providerId` или `draftToken` | `result` |
| `provider.reauthorize` | нет | `id`, `model` | `result`, обновляет кэш команды авторизации и проверяет модель |
| `provider.actualize` | нет | `id` | `result`, `info` |
| `catalog.status` | нет | нет | `status` |
| `catalog.sync` | нет | нет | `status` |
| `catalog.list` | нет | нет | `providers` |
| `catalog.provider` | нет | `id` | `provider` |
| `files.list` | нет | нет | `files` |
| `files.change` | нет | `operation`, `path`, `destination?`, `directory?`, `confirm?` | создание, переименование или корзина файла |
| `files.search` | нет | `query`, `caseSensitive`, `wholeWord`, `include` | `search`, результаты поиска в проекте |
| `files.replace` | нет | параметры поиска и замены | `replacement`, проверенная замена в проекте |
| `files.git` | нет | `action`, `path?`, `staged?`, `message?` | `git`, состояние или результат операции |
| `ide.terminal` | нет | `action`, `data?`, `cursor?`, `cols?`, `rows?` | `terminal`, отдельная пользовательская PTY |
| `files.read` | нет | `path` | `file`: `path`, `size`, `text`, `truncated`, `binary`, `hash?`, `readOnlyReason?` |
| `files.write` | нет | `path`, `text`, `expectedHash` | `file` после сохранения |
| `commands.list` | нет | нет | `commands` |

Значения полей:

- `reasoning`: `none`, `minimal`, `low`, `medium`, `high`, `xhigh` или `max`; без него берётся значение из конфига, а модель без такого уровня получает ближайший поддержанный.
- `files.read`: путь относительно проекта; symlink раскрывается до проверки, файл вне проекта, FIFO и устройство отклоняются. Отдаётся не больше 512 KB текста по границе строки (`truncated: true`), секреты замаскированы, у бинарного файла `binary: true` и пустой `text`. Так окно открывает файл из карточки и полный лог тула.
- `files.write`: сохраняет существующий UTF-8 файл до 512 КБ атомарно с прежними правами и BOM. `expectedHash` берётся из последнего `files.read`; несовпадение отклоняет запись и предлагает открыть актуальную версию. Бинарные, усечённые, замаскированные файлы, UTF-16 и служебные пути `.git`/`.liquid` доступны только для просмотра, с `readOnlyReason` вместо `hash`. Путь за пределы проекта не допускается.
- `decision`: `allow_once`, `allow_always` или `deny`. `allow_always` сохраняет правило в конфиг.
- `target`: `before` (по умолчанию, состояние до хода) или `after`. `force` перезаписывает файлы, которые пользователь менял после хода; `includeProtected` разрешает защищённые пути.
- `protocol`: `openai-chat`, `openai-responses`, `anthropic-messages` или `gemini`.
- `clientId` связывает ошибку `run_failed` с черновиком окна, у которого ещё нет `sessionId`.
- `resumed` помечает запуск, который продолжает прерванную задачу.

```json
{ "type": "run", "prompt": "сделай лендинг", "reasoning": "medium" }
```

```json
{ "type": "approval.respond", "id": "a_12", "decision": "allow_once" }
```

```json
{ "type": "checkpoint.restore", "sessionId": "s_1", "id": "c_3", "target": "before", "paths": ["src/app.ts"] }
```

## События

| Событие | Полезная нагрузка |
|---|---|
| `session.started` | `prompt`, `provider`, `model`, `input?`, `attachments?` (проверенные metadata references), `reasoning?`, `system?`, `queueId?`, `resumed?`, `budget?` |
| `session.state` | `sessionId`, `state`: канонические phase, epoch/revision, queue, approvals и jobs |
| `turn.started` | `turn` |
| `message.started` | нет; сохраняет позицию первого фрагмента текста в хронологии |
| `message.delta` | `text` |
| `reasoning.delta` | `text` |
| `message.finished` | `text`, `reasoning`, `toolCalls`, `summary?`, `complete?`, `display?` |
| `message.reset` | `reason` |
| `model.fallback` | `provider`, `model`, `reason` |
| `provider.retry` | `kind`, `attempt`, `delayMs`, `until`, `reason` |
| `tool_call.progress` | `index`, `name?`, `delta?` |
| `tool.output` | `callId`, `text`, очищенный поток вывода выполняющегося вызова |
| `twin.activity` | `activity`: taskId?, phase, state, emotion, voice, instructions, entryIds, corrections, provider, model, usage? | durable диалог Twin с Worker, приёмка и стоимость |
| `worker.event` | `sessionId` родительского чата, `event` из сессии Worker; вложенный envelope запрещён |
| `subagent.started` | `subagent`: стабильные `id`, `callId`, `name`, `avatar`, `agent`, исходный `prompt` |
| `subagent.event` | `id`, `event`: типизированное событие дочерней сессии, без вложенных исполнителей |
| `subagent.finished` | `id`, `result`: проверенный отчёт, usage и ошибка; `cancelled`: явная остановка или предел времени |
| `tool.started` | `call` |
| `tool.finished` | `call`, `result` |
| `steer.applied` | `text`, `input?`, `queueId?` |
| `notice.applied` | `text` |
| `job.started` | `job` |
| `job.finished` | `job`, `notify`, `checkpoint?` |
| `budget` | `budget` |
| `run.interrupted` | `at`, `reason` |
| `context.compacted` | `summary`, `displaySummary?`, `pruned`, `before?`, `after?`, `kept?`, `page?`, `path?`, `source?`, `focus?` |
| `context.usage` | `used`, `window`, `reserve`, `source` |
| `memory.context` | `text`, `references`: массив `{id, revision, level}`, уровни `index`, `full`, `invalidated` |
| `usage` | `usage`, `purpose?`, `provider?`, `model?`, `durationMs?` |
| `input.translated` | `input`, `language`, `system?` |
| `translation.failed` | `message` |
| `hook.finished` | `hook` |
| `turn.finished` | `turn`, `reason` |
| `session.finished` | `result` |
| `approval.requested` | `approval` |
| `approval.resolved` | `id`, `choice`, `by` |
| `error` | `code`, `message`, `sessionId?`, `limit?`, `resetAt?` |

Каждое событие, кроме части `error`, несёт `sessionId`, а на проводе ещё и `seq`.

`memory.context` сохраняется в durable JSONL и восстанавливается replay как внутренний model context: `text` становится отдельным контекстным сообщением, `references` переносятся в его `memoryReferences`. Каждая ссылка содержит `id`, положительную `revision` и `level`: `index`, `full` или `invalidated`. Ссылка `catalog:<SHA-256>` с revision 1 обозначает реально доставленный снимок тематического каталога, не отдельную сохранённую запись. Событие фиксирует фактически доставленные сведения и их ревизии, не новое сообщение человека; `memorySource` пользовательского evidence ему не присваивается. Это позволяет сохранить учёт видимости после reopen и снять его, когда соответствующее содержимое удалено compaction. Контракт памяти и пределы описаны в [MEMORY.md](MEMORY.md).

При массовом отзыве invalidated references также снимают прежние memory messages из provider projection и при replay. Сырые tool events не переписываются. Обычный discovery ограничен 16 references; отдельное уведомление массового отзыва допускает references для всего ограниченного банка. Metadata не превращается в тысячи токенов модельного текста.

- `tool_call.progress`, `message.delta`, `reasoning.delta` и `provider.retry` это индикаторы: они не пишутся в JSONL и не входят в повтор после `message.finished`.
- `message.reset` отменяет показанный частичный ответ: провайдер оборвал поток, и ход идёт заново.
- `provider.retry` сообщает, что запрос уйдёт снова в `until` (мс от эпохи).
- `model.fallback` приходит перед первым токеном резервной модели: основная ответила ошибкой `reason` (`rate_limit`, `quota`, `server`, `network`, `timeout`, `circuit_open` и другие), и запрос ушёл в `provider`/`model` из `failover`. Событие пишется в лог, поэтому история показывает, какая модель ответила.
- `steer.applied` приходит, когда сообщение пользователя дошло до модели; `queueId` связывает его с элементом очереди.
- `notice.applied` приходит, когда модель получила уведомление оболочки, например о завершённой фоновой задаче.
- `budget` приходит при каждом изменении расхода; `budget.exceeded` называет предел (токены, деньги или время), который остановил задачу.
- `run.interrupted` пишется в лог задачи, которую оборвал перезапуск или падение sidecar.
- `approval.requested` приходит с `approval.expiresAt`; в этот момент вызов будет отклонён. `approval.resolved.by`: `user`, `timeout` или `aborted`.
- `error.limit` (`rate`, `five_hour`, `weekly`, `billing`) и `resetAt` приходят, когда задачу остановил лимит провайдера.

## Служебные сообщения

Эти строки пишет не ядро, а sidecar (`src/app/server.ts`) или оболочка Electron (`shell/main.mjs`).

| Сообщение | Источник | Полезная нагрузка |
|---|---|---|
| `status` | sidecar | проект, ветка, пользователь, провайдер, модель, окно контекста, список провайдеров, навыки, MCP, песочница, промпт, снимки shell, `configError?`, `sessions` |
| `response` | sidecar и оболочка | `requestId`, `ok`, поля ответа или `error` |
| `sessions.interrupted` | sidecar | `interrupted`, `resumed` |
| `agent.exit` | оболочка | `code`, `signal?`, `message?` |
| `project.changed` | оболочка | `cwd` |

`status` приходит при старте, после `hello`, `status`, `trust.accept`, `settings.save` и `model.set`. `sessions` это активность всех задач: `sessionId`, `running`, `turns`, `queue`, `approvals`, `jobs`. Если провайдер не настроен, `configError` содержит причину, но sidecar продолжает работать.

`sessions.interrupted` приходит после старта, если прошлый процесс оборвал задачи. `interrupted` перечисляет их, `resumed` те, которые sidecar сам продолжил (`sessions.autoResume`, не больше `sessions.maxConcurrent`; задачу, которая уже была продолжением, повторно не продолжает).

`agent.exit` значит, что процесс ядра завершился; окно показывает ошибку и предлагает запустить задачу снова. `project.changed` приходит, когда пользователь открыл другой проект: оболочка перезапускает ядро в новой папке.

## Ошибки

Ошибка команды без `requestId` и ошибка задачи приходят событием:

```json
{ "type": "error", "code": "invalid_input", "message": "prompt is required" }
```

| Код | Когда |
|---|---|
| `invalid_input` | команда или поле не прошли проверку |
| `provider_failed` | провайдер не ответил после всех повторов и запасных моделей |
| `context_overflow` | запрос не влез в окно контекста даже после сжатия |
| `provider_limit` | лимит провайдера, с `limit` и `resetAt` |
| `cancelled` | задачу остановили |
| `run_failed` | `run` не стартовал, с `sessionId` или `clientId` |
| `startup_failed` | sidecar не смог запуститься |
| `project_locked` | в этом проекте уже работает другое ядро Flecten, в сообщении его pid и путь к замку |
| `protocol` | оболочка получила от ядра строку, которая не JSON |

## Версии

Ломающее изменение протокола поднимает версию sidecar и версию приложения. Клиент обязан показать ошибку, а не молча ждать событий.

## Открытие задачи из ссылки

Установленное приложение принимает `flecten://session/<id>?project=<absolute-path>` через OS protocol handler. Оболочка проверяет схему, id, абсолютную существующую папку и отсутствие дополнительных полей. После подключения окна приходит `session.open` с `id`. Ссылка выбирает сохранённую задачу, не отправляет сообщения модели и не меняет доверие проекту. Тестовые и dev-запуски не меняют обработчик ссылок в системе.

## События Talker и Worker

`session.started` может содержать `role: talker | worker`. Поле `internal: true` обозначает запуск Talker по уведомлению харнесса; оно не является сырым пользовательским сообщением и не меняет последний запрос. Внешняя команда `run` не может назначить себе эти поля.

`worker.event` содержит `sessionId` родительского чата и проверенное вложенное событие `event` из сессии Worker. Рекурсивные Worker envelopes не допускаются. Scoped `call.id` одинаков в начале, выводе, результате и ссылке `[[id]]`. `tool.output` содержит `callId` и очищенный фрагмент `text`; результат `tool.finished` остаётся окончательным источником статуса и полного лога.

`stop` с `target: worker` останавливает только исполнителя с указанным mode. Обычный `stop` останавливает оба цикла разговорной сессии. Субагенты продолжают работать в обоих случаях, а ожидание их результата завершается. `subagent.stop` принимает id дочернего исполнения, `task` с operation stop даёт Worker или основному агенту тот же контроль. `tool.cancel` принимает scoped идентификатор и разрешает его только в своём родительском чате. Закрытие приложения завершает дочерние исполнения; отдельного фонового процесса вне runtime нет.
