export default {
  "Module request queue is full. Wait for a pending request to finish.":
    "Очередь запросов модуля заполнена. Дождитесь завершения текущего запроса.",
  "Project service": "Сервис проекта",
  "Native module code runs with the permissions of the agent process.":
    "Нативный код модуля работает с правами процесса агента.",
  "Project services start when this module and project are trusted.":
    "Сервисы проекта запускаются после доверия модулю и проекту.",
  "Session services start when the agent activates this module.":
    "Сервисы чата запускаются, когда агент активирует модуль.",
  "Use module interface": "Использовать интерфейс модуля",
  "Stop using module interface": "Отключить интерфейс модуля",
  "Resume module interfaces": "Возобновить интерфейсы модулей",
  "Restore native interface": "Вернуть штатный интерфейс",
  "Interface changes can replace the entire app. Ctrl+Shift+F12 restores the native interface.":
    "Модуль может заменить весь интерфейс приложения. Ctrl+Shift+F12 возвращает штатный интерфейс.",

  Modules: "Модули",
  "Module folder": "Папка модуля",
  "On demand": "По запросу",
  "Could not load modules": "Не удалось загрузить модули",
  "Could not update module": "Не удалось обновить модуль",
  "Could not load module surface": "Не удалось открыть интерфейс модуля",
  "Loading module surface…": "Загрузка интерфейса модуля…",
  "The agent activates tools, instructions, hooks and workspace surfaces for the current task. Other modules stay out of context.":
    "Агент подключает инструменты, инструкции, хуки и рабочие интерфейсы для текущей задачи. Остальные модули не занимают контекст.",
  "Add a package containing .flecten-module/module.json, then review and trust its version.":
    "Добавьте пакет с .flecten-module/module.json, затем проверьте содержимое и подтвердите доверие к версии.",
  "Reload local changes automatically": "Автоматически загружать локальные изменения",
  "Development reload trusts future edits in this folder. Active chats apply them between agent turns.":
    "В режиме разработки доверие распространяется на будущие изменения в этой папке. Активные чаты применяют их между ходами агента.",
  "No modules installed. Add a module folder to get started.":
    "Модули ещё не установлены. Добавьте папку модуля.",
} as const;
