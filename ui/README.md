# UI

Svelte 5 и Vite. Интерфейс только показывает данные и отправляет действия. Он не читает файлы, не зовёт модели и не хранит состояние сессии.

## Запуск

```bash
bun run dev:ui     # браузер
bun run app:dev    # Electron и Vite
bun run build:ui   # ui/dist
```

## Правила

- Данные приходят через props из контейнера экрана.
- События ядра приходят через `src/lib/desktop.ts` и `run.svelte.ts`.
- Компонент не читает файлы и не зовёт модель.
- Визуальные токены, шрифты и базовые стили лежат в `src/app.css`.
- Компонент не импортирует оболочку и не знает про Electron.
- Интерактив работает с клавиатуры, имеет подпись и видимый фокус.
- `prefers-reduced-motion` оставляет статичное состояние.
- Новая зависимость требует записи в журнале решений.

## Дерево

```text
src/
  main.ts                 точка входа
  App.svelte              состояние окна и горячие клавиши
  app.css                 токены, шрифты, база
  assets/fonts/           Manrope и лицензия
  lib/
    types.ts              типы данных интерфейса
    icons.ts              карта Hugeicons для имени иконки
    agent.ts              мапперы тулов, диффов и терминала
    run-machine.ts        чистая машина фаз
    run.svelte.ts         состояние треда, события sidecar, расход контекста
    motion.ts             expand, enter, reduced motion
    media.svelte.ts       реакция на prefers-reduced-motion
    toast.svelte.ts       одноразовые уведомления
    format.ts             русские формы слов
    desktop.ts            мост к окну Electron
    platform.ts           Ctrl или Cmd
  components/
    TitleBar.svelte
    Sidebar.svelte
    ProjectGroup.svelte
    TaskRow.svelte
    MainPane.svelte
    MainHeader.svelte
    SessionState.svelte
    Thread.svelte
    UserMessage.svelte
    RunGroup.svelte
    FileChangeChip.svelte
    FileTypeBadge.svelte
    Answer.svelte
    LiveRun.svelte
    LiveGlow.svelte
    Composer.svelte
    ComposerBar.svelte
    InspectorPanel.svelte
    ChangesPane.svelte
    DiffFile.svelte
    ChecksPane.svelte
    CheckRow.svelte
    TerminalPane.svelte
    Toast.svelte
    Icon.svelte
    MorphIcon.svelte
    GooFilters.svelte
```

## Поток

1. `App.svelte` держит видимость панелей, активную вкладку и `RunStore`.
2. `Composer` отправляет текст через `RunStore.start`.
3. `Thread` рисует сообщения, сводку прогона и живой статус.
4. `InspectorPanel` показывает изменения, проверки и терминал из событий тулов.
5. `LiveGlow` живёт только пока идёт прогон, останавливает `requestAnimationFrame` вне области и при reduced motion.

## Добавить компонент

Создай файл в `src/components`, опиши props через `$props()` и держи стили в `<style>`. Если компоненту нужны данные экрана, передай их из `App.svelte` или `MainPane.svelte`. Листовой компонент не импортирует состояние ядра.

## Проверки

```bash
bun run check
bun run lint
bun run build:ui
```

Визуальную правку проверяй в браузере на 1480x940 и 1180x640, а также с `prefers-reduced-motion: reduce`.
