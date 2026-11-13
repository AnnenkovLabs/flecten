# E2E в Electron

Проверка поднимает настоящий процесс Electron, настоящее ядро на Bun и локальный mock-провайдер. Сеть и реальные ключи не нужны. Окно создаётся, но не показывается: fixture выставляет `FLECTEN_HEADLESS=1`, а `shell/main.mjs` пропускает `win.show()`.

## Запуск

```bash
bun install
bun run test:e2e
```

`test:e2e` собирает `ui/dist`, собирает `dist/flecten-agent` и запускает Playwright. Отдельный `playwright install` не нужен: тесты используют Electron из `node_modules`.

Прямой запуск без сборки:

```bash
bun run build:ui
bun run build:agent
bunx playwright test
```

Один тест:

```bash
bunx playwright test tests/e2e/app.spec.ts -g "new session"
```

Список без запуска:

```bash
bunx playwright test --list
```

## Как устроено

- `playwright.config.ts`: один worker, последовательные тесты, таймауты, trace и screenshot при падении.
- `tests/e2e/fixtures.ts`: временный `FLECTEN_CWD`, временный `FLECTEN_CONFIG`, `FLECTEN_HEADLESS=1`, запуск mock-провайдера, запуск Electron через `_electron.launch`, сбор ошибок консоли и очистка. Окно не показывается и не забирает фокус.
- `tests/e2e/app.spec.ts`: smoke-сценарий, потоковый скелетон, очередь сообщений, блоки кода с копированием и Mermaid; проверяет, что iframe саммари загружен из `liquid-summary://`, не использует `srcdoc`, не показывает сырой `<summary>`, исполняет инлайн JS и переключает вкладки, а «Открыть файл» в карточке `read` показывает файл в просмотрщике и закрывается по Esc.
- `tests/e2e/notices.spec.ts`: ошибка висит над композером до «Скрыть», info гаснет сам; второе окно на том же проекте получает `project_locked` и не перезапускает ядро по кругу.
- `tests/e2e/visual.spec.ts`: снимки треда с тулом и саммари, настроек, нового экрана и пустого состояния на 1480x940 и 1180x640, плюс reduced motion. Как обновлять снимки, описано в `tests/e2e/README.md`.
- `tests/e2e/polish.visual.spec.ts`: фокус после отправки, время сообщений, поиск по треду, кнопка «Вниз», rename и delete задачи, подсказка drop на 1180x640; снимки идут в папку результатов Playwright.
- `tests/e2e/scrollbar-check.spec.ts`: документ не скроллится ни на 1480x940, ни на 1180x640, до прогона и после него; скроллятся только панели.
- `scripts/e2e-mock.mjs`: OpenAI Chat Completions SSE. Первый ответ просит `read README.md`, второй отдаёт текст и HTML в `<summary>` несколькими чанками, чтобы проверить потоковую сборку. `E2E_MOCK_CALLS` (JSON-массив `{ name, arguments }`) и `E2E_MOCK_REPLY` задают другие вызовы и ответ.
- `docs/E2E.md`: этот файл.

Каждый тест получает свой временный проект с `README.md` и `flecten.config.json`. После теста временная папка удаляется. Конфиг отключает каталог моделей и sandbox, чтобы прогон не зависел от машины.

## Linux без дисплея

Если `DISPLAY` и `WAYLAND_DISPLAY` пусты, harness создаёт временную обёртку и запускает Electron через `xvfb-run -a`. Нужен установленный `xvfb`:

```bash
sudo apt-get install -y xvfb
```

Если `xvfb-run` нет, тесты пропускаются с сообщением про display. Так же они пропускаются, если нет Electron, `ui/dist` или `shell/main.mjs`.

## CI

GitHub Actions с Ubuntu:

```yaml
- run: bun install --frozen-lockfile
- run: bun run test:e2e
```

На ubuntu-latest `xvfb` уже установлен. Если раннер сам запускает Xvfb, можно обойтись без обёртки:

```bash
xvfb-run -a bun run test:e2e
```

Тесты нельзя запускать параллельно в одном X-сервере: конфиг фиксирует `workers: 1`.

## HTML summary и CSP

`HtmlSummary.svelte` не собирает документ из модели. Саммари монтируется в `<iframe src="liquid-summary://shell" sandbox="allow-scripts">`, а содержимое приходит сообщениями: конфиг с темой и шрифтами, затем токены HTML, затем `finish`, который запускает инлайн скрипты. Парсер на стороне интерфейса отрезает `<summary>` от Markdown, показывает скелетон и отправляет только завершённые токены, поэтому сырой код не виден.

Документ `liquid-summary://shell` отдаёт main process из `shell/summary-runtime.js` с собственным заголовком `Content-Security-Policy`. Это важно: Blob и `srcdoc` наследуют CSP родительской страницы, а `unsafe-inline` в дочернем `<meta>` не может его ослабить. Custom protocol даёт документу отдельную политику, поэтому инлайн runtime и инлайн скрипты модели работают, не ослабляя CSP приложения.

Граница остаётся прежней: `sandbox="allow-scripts"` без `allow-same-origin` даёт opaque origin, модель не видит DOM родителя, файлы, ключи и мост. CSP дочернего документа запрещает `connect-src` и вложенные фреймы. Высота и действия приходят через `postMessage`; получатель проверяет `event.source` и схему сообщения. Тема и Manrope передаются из родителя сообщением `config`, данные шрифтов идут как `data:` URL.

## Известные пределы

- 12 тестов в 5 файлах: новый экран, tool call, детали тула, просмотрщик файла и HTML-саммари; потоковый скелетон; очередь; блоки кода и Mermaid; уведомления; второе окно на занятом проекте; визуальные снимки; полировка треда; отсутствие скролла документа. Approval с отказом, Allow All и Deny All проверены сквозным тестом пула сессий (`tests/unit/session-pool.test.ts`), а не в Electron. Diff, undo, resume и steering в Electron пока не покрыты, они проверены unit-тестами ядра.
- Mock поддерживает только `openai-chat`. Другие протоколы проверяются unit-тестами.
- Визуальные snapshots покрывают новый экран, пустое состояние, настройки и thread с саммари на 1480x940 и 1180x640 и reduced motion. Время, живые индикаторы, длительности, стоимость, пути и приветствие замаскированы.
- В приложении нет `data-testid`. Тесты держатся за стабильные id (`#new-session-prompt`, `#prompt`), aria-label (`Новая сессия`, `Очередь сообщений`, `Остановить`, `Отправить`) и классы (`run-summary`, `action`, `detail-section`, `summary`, `live-run`). Переименование этих селекторов ломает тесты.
- Очередь проверяется по появлению и исчезновению tray, остановке индикатора прогона и наличию саммари. Отдельная проверка текста второго прогона не делается, потому что UI не показывает сообщение из очереди как отдельный элемент треда.
- Trace и screenshot при падении лежат в `.liquid/e2e-results/`.
