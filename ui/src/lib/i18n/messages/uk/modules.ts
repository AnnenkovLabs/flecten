export default {
  "Module request queue is full. Wait for a pending request to finish.":
    "Черга запитів модуля заповнена. Дочекайтеся завершення поточного запиту.",
  "Project service": "Сервіс проєкту",
  "Native module code runs with the permissions of the agent process.":
    "Нативний код модуля працює з правами процесу агента.",
  "Project services start when this module and project are trusted.":
    "Сервіси проєкту запускаються після надання довіри модулю та проєкту.",
  "Session services start when the agent activates this module.":
    "Сервіси чату запускаються, коли агент активує модуль.",
  "Use module interface": "Використовувати інтерфейс модуля",
  "Stop using module interface": "Вимкнути інтерфейс модуля",
  "Resume module interfaces": "Відновити інтерфейси модулів",
  "Restore native interface": "Повернути стандартний інтерфейс",
  "Interface changes can replace the entire app. Ctrl+Shift+F12 restores the native interface.":
    "Модуль може замінити весь інтерфейс застосунку. Ctrl+Shift+F12 повертає стандартний інтерфейс.",

  Modules: "Модулі",
  "Module folder": "Папка модуля",
  "On demand": "За запитом",
  "Could not load modules": "Не вдалося завантажити модулі",
  "Could not update module": "Не вдалося оновити модуль",
  "Could not load module surface": "Не вдалося відкрити інтерфейс модуля",
  "Loading module surface…": "Завантаження інтерфейсу модуля…",
  "The agent activates tools, instructions, hooks and workspace surfaces for the current task. Other modules stay out of context.":
    "Агент підключає інструменти, інструкції, хуки та робочі інтерфейси для поточного завдання. Решта модулів не займають контекст.",
  "Add a package containing .flecten-module/module.json, then review and trust its version.":
    "Додайте пакет із .flecten-module/module.json, потім перевірте вміст і підтвердьте довіру до версії.",
  "Reload local changes automatically": "Автоматично завантажувати локальні зміни",
  "Development reload trusts future edits in this folder. Active chats apply them between agent turns.":
    "У режимі розробки довіра поширюється на майбутні зміни в цій папці. Активні чати застосовують їх між ходами агента.",
  "No modules installed. Add a module folder to get started.":
    "Модулі ще не встановлено. Додайте папку модуля.",
} as const;
