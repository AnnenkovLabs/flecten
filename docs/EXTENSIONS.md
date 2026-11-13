# Расширения

## Модули с активацией по задаче

`module` объединяет SDK runtime, MCP, инструкции, resources, хуки и произвольные HTML-поверхности. Агент подключает пакет только для текущего чата; hot-load добавляет новый контекст в хвост истории, сохраняя системный префикс и provider tool definitions. Формат пакета, SDK, доверие и границы кэша описаны в [MODULES.md](MODULES.md). Отдельные skills, MCP и hooks также доступны через свои настройки. Экспериментальная система plugins удалена; старое поле `plugins` игнорируется при загрузке конфига и исчезает при следующем сохранении. Установленные файлы не удаляются и автоматически в модули не превращаются.

Состояние на 2026-11-10. Расширения работают через обычную сессию, общий реестр инструментов, permissions, durable events и бюджет контекста. Настройки показывают источники, доверие и состояние подключения. Новая зависимость требует решения в [DECISIONS.md](DECISIONS.md).

## Skills

Навык это папка с `SKILL.md`, YAML frontmatter и Markdown. Каталог содержит имя и описание. Тело загружается при явной slash-активации или вызове `skill`.

| Область | Каталоги в порядке приоритета |
|---|---|
| Пользователь | `~/.claude/skills`, `~/.agents/skills`, `~/.liquid/skills` |
| Проект | `.claude/skills`, `.agents/skills`, `.liquid/skills` |

Проект перекрывает пользовательский источник с тем же именем. `.liquid` имеет приоритет над `.agents`, затем `.claude`. Перекрытия видны в диагностике. Настройка `skills.sources` включает источники отдельно; пустой массив отключает их все.

- Навыки перечитываются перед новым прогоном и при открытии slash-меню. Идущий прогон сохраняет свой реестр до безопасной границы.
- Trust проверяется до загрузки тела. Настройки позволяют запретить или разрешить навык, показывают источник, версию и ресурсы.
- Повторная активация дедуплицируется. `allowed-tools` сужает инструменты сессии в registry и восстанавливается после reopen из успешных durable tool events. Поле не расширяет permissions.
- Если модель прислала активацию и другой вызов одним batch, активация применяется до следующего вызова.
- `SKILL.md` ограничен 256 КиБ, каталог 200 навыками. Каталог промпта и описания ограничены отдельно.
- Браузер ресурсов показывает обычные текстовые файлы внутри папки навыка. Canonical path и symlink проверяются; глубина, количество и размер ограничены. Просмотр ничего не исполняет.

## MCP

Используется официальный `@modelcontextprotocol/client` 2.4.0. SDK согласует modern/legacy протокол, проверяет схемы, управляет таймаутами и отменой. `protocol: "auto"` поддерживает серверы с legacy initialize.

Сервер задаётся через stdio (`command`, `args`, `env`) или Streamable HTTP (`url`, авторизация). Сохранение настроек пересобирает MCP без перезапуска приложения. Исполняемые настройки проекта требуют доверия.

Настройки MCP показывают:

- состояние, health, tools и время последнего подключения;
- `allowTools`, `readOnly`, таймаут и бюджет контекста;
- reconnect, хвост redacted stderr и ошибки;
- ресурсы, шаблоны ресурсов и prompts.

`list_changed` обновляет каталоги. Tool names получают `mcp_<server>_<tool>`, проверяются схемой SDK, permission engine и общим registry. `readOnlyHint` сервера не даёт дополнительных прав. `readOnly` блокирует tools сервера и оставляет чтение ресурсов и prompts.

Ресурс можно прикрепить через `@` с источником и ограниченным текстом. Prompts доступны как команды. Модель также получает `read_resource` и `use_prompt`. Инструкции и результаты сервера считаются недоверенными данными; действуют лимиты числа tools, размера схем и общего контекста. Blob и binary не печатаются в промпте как base64.

### OAuth и elicitation

Streamable HTTP использует OAuth discovery SDK, PKCE, loopback callback, проверку issuer/state и refresh токена. Окно показывает consent и открывает URL после действия пользователя. Токены остаются в backend secret store: keychain при доступности, закрытый файл как fallback. Renderer не получает токены, headers или команды авторизации.

Elicitation работает для stdio и HTTP. Окно строит форму из проверенной схемы, поддерживает submit, cancel, timeout и отмену сессии. Ответ проверяется до отправки серверу. Sampling не реализован.

## Hooks

Именованные command и HTTP действия настраиваются формой: событие, буквальные условия, команда или URL, политика ошибки и timeout. Один каталог `shared/hooks.ts` задаёт события, схемы и возможности ядра и интерфейса. Новый action по умолчанию принимает текстовый вывод; JSON выбирается явно для `decision`, `reason` и `additionalContext`. Отсутствующее поле `responseFormat` сохраняет JSON-семантику старого конфига.

Черновик проверяется без сохранения тем же runner с типизированным примером. Несовпадение условий не запускает transport. История показывает последние 50 реальных запусков в текущей задаче, восстанавливается через replay `hook.finished` и не смешивается с ручными тестами. Command execution использует общие terminal helpers, окружение из allowlist, timeout, отмену и bounded output. HTTP работает через POST без redirect.

Код 2 и `decision: "deny"` блокируют только допустимое событие. Ошибка блокирует при `failClosed`; observer не отменяет уже выполненное действие. Async доступен observer-событиям. Начало и конец относятся к каждому прогону, а natural stop не означает нажатие кнопки остановки. Полный список событий, пределы, примеры и протокол находятся в [HOOKS.md](HOOKS.md). Исходники OpenCode 2, Oh My Pi, Pi и Gemini CLI разобраны в [исследовании](research/hooks-harnesses.md).

## Subagents, LSP и форматтеры

Определения субагентов из пользовательских каталогов и `.liquid/agents` задают модель, tools, permissions и бюджеты. Проектные определения требуют доверия. `task` запускает настоящую дочернюю сессию с ограничениями; её permissions пересекаются с правами родителя, а registry проверяет ограничения активного родительского skill. Родительские deny и ask запрещают действие дочернему прогону без создания скрытого approval.

LSP и форматтеры задаются в конфиге и используются инструментами. Аргументы и результаты проходят общие проверки, ограничения путей и отмену. Здесь нет отдельного агентского фреймворка.

## Остальные продуктовые пути

- Checkpoints сохраняют pre/post-image, shell-команды получают снимок в отдельном shadow git; undo/redo не меняют git пользователя.
- Persistent PTY и jobs имеют id, статус, лог, wait, stop и уведомление своей сессии.
- Очередь и steering сохраняются на диск, сообщения имеют стабильный id.
- Вложения включают изображения, PDF и audio. OpenAI Chat принимает WAV/MP3, Gemini inline audio; протокол без поддержки сообщает об этом до запроса. Оценка контекста учитывает размеры изображений, PDF и длительность поддержанных аудиоформатов.
- Голосовой ввод даёт редактируемый черновик, см. [VOICE.md](VOICE.md).
- HTML summary исполняет inline CSS/JS в iframe с `allow-scripts`, без same-origin и сети; получает тему и Manrope.

## Примеры конфигурации

Формы настроек сохраняют эти поля. Примеры проверяет `docs:check` по схеме входного конфига.

```json
{
  "skills": { "sources": ["user-agents", "project-liquid"] },
  "mcp": {
    "servers": {
      "docs": { "command": "bun", "args": ["mcp/docs-server.ts"], "env": { "DOCS_ROOT": "./docs" }, "protocol": "auto", "timeoutMs": 60000, "maxTools": 64 }
    }
  }
}
```

```json
{
  "hooks": {
    "preToolUse": [{ "command": "bun .agents/hooks/guard.ts", "matcher": "bash", "timeoutMs": 5000, "failClosed": true }],
    "sessionEnd": [{ "command": "bun .agents/hooks/cleanup.ts", "timeoutMs": 10000 }]
  }
}
```

```json
{
  "permissions": {
    "read": "auto", "write": "auto", "shell": "ask", "network": "ask", "mcp": "ask", "skill": "allow", "externalPath": "deny",
    "rules": [{ "action": "write", "tool": "edit", "pathPrefix": "src", "policy": "allow", "note": "Правки исходников проекта" }]
  }
}
```

```json
{
  "sessions": { "retentionDays": 90, "maxSessions": 1000, "trashDays": 30 },
  "telemetry": { "enabled": false }
}
```

## Границы и проверки

AppContainer и отдельный Job Object для каждой команды Windows ещё не подключены. Persistent PTY использует штатный ConPTY Bun 1.4.2; paths/native shell/CIM/process tree требуют Windows runner. Sidecar включает Bun no-orphans для удаления потомков при завершении приложения. Подписанный release/update channel требует сертификатов CI и публикации. Это ограничения реализации и внешней приёмки; Linux fixtures их не закрывают.

Основные проверки: `extension-runtime`, `skill-lifecycle`, `mcp-oauth`, `mcp-elicitation`, `modules`, `hooks`, `subagent-integration`, `attachments`, `queue` в `tests/unit`, а также `tests/e2e/extensions.spec.ts`. Полная актуальная приёмка фиксируется в `IMPLEMENTATION-CHECKLIST.md`.

## Источники

Отдельный OAuth MCP-сервер для поиска и чтения X из ChatGPT описан в [connectors/x-chatgpt](../connectors/x-chatgpt/README.md). Он запускается независимо от приложения командой `bun run connector:x`.

- [Agent Skills specification](https://agentskills.io/specification)
- [MCP lifecycle](https://modelcontextprotocol.io/specification/2026-07-28/basic/lifecycle)
- [MCP transports](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports)
- [SDK v2 client](https://ts.sdk.modelcontextprotocol.io/v2/clients/connect)

## Описание изображений

`vision` задаёт необязательные `provider` и `model`. Пустой `provider` означает провайдера рабочей модели; пустой `model` выбирает среди включённых моделей с явно заявленным зрением и известной ценой минимальную сумму `cost.input + cost.output`. При равенстве используется порядок model id. Без подходящей цены настройка требует явного выбора, неизвестная цена не считается нулевой. Ручной выбор допускает модели без tool calling и с неизвестной ценой, но требует поддержку входных изображений. Обычная зрячая модель получает исходное изображение напрямую.

В общих настройках используется тот же ModelPicker с поиском, группами провайдеров и избранным. Выбор сохраняется как `vision: { "provider": "provider-id", "model": "model-id" }`. Кнопка Auto возвращает автоматический выбор. Изображения буфера сохраняются в отдельные закрытые временные папки, при отправке копируются в durable attachments сессии. Незрячая модель получает описание и путь; повторный `read` поддерживает необязательный `focus`. Описание ограничено 60 000 символами, запрос 120 секундами, кэш 64 описаниями за время жизни сессии. Ошибка описания остаётся явной ошибкой, изображение сохраняется для повтора.
