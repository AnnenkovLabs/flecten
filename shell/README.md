# Shell

Electron 45. Окно, preload, протокол и запуск sidecar.

## Запуск

```bash
bun run app:dev   # Vite и Electron
bun run app       # сборка интерфейса и Electron
bun run app:shot  # снимок окна во временный файл
```

## Дерево

```text
main.mjs      окно, протокол liquid://, IPC, запуск ядра, снимок
preload.cjs   единственный мост window.desktop: окно и команды агенту
```

## Загрузка интерфейса

- В dev окно грузит `FLECTEN_DEV_URL` от Vite.
- В продакшене окно грузит `liquid://app/index.html`.
- Протокол отдаёт только файлы внутри `ui/dist`. Обход пути возвращает 404.
- Ответы читаются через `readFile`, поэтому работают и внутри `asar`.

## Безопасность

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`.
- `preload.cjs` отдаёт `control(action)`, `agent.send(command)` и `agent.onEvent(listener)`.
- Главный процесс проверяет действие и тип команды по списку.
- Ядро запускается отдельным процессом на Bun и не получает Electron API.
- Внешние окна запрещены, навигация за пределы приложения заблокирована.
- CSP задаётся в `ui/index.html`.

## Границы

Оболочка знает про окно, файлы интерфейса и процесс ядра. Она не знает про Twin, тулы, контекст и страницы. Если в `main.mjs` появилась логика харнесса, граница протекла.

В dev ядро запускается через `bun run src/app/server.ts`. В собранном приложении используется `resources/flecten-agent`, а промпты лежат в `resources/prompts`.

Electrobun остаётся целью для продакшн-оболочки по ADR-003. Electron используется как рабочая оболочка и упаковывается через `electron-builder.yml`.
