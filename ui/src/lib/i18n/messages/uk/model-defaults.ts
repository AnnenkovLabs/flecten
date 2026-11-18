export default {
  "Main model": "Основна модель",
  "Default main model": "Основна модель за замовчуванням",
  "Used when Talker and Worker is off, and as the fallback for role defaults.":
    "Використовується в одноагентних чатах і для ролей зі значенням за замовчуванням.",
  "Defaults apply to new chats. You can still choose a model in the message box.":
    "Застосовується до нових чатів. Для окремого чату модель обирається в полі вводу.",
  "Talker handles your conversation. Worker carries out tasks with tools, for any kind of work.":
    "Talker відповідає в діалозі без затримок, поки Worker запускає інструменти й редагує файли в окремій сесії.",
  "Talker model": "Модель Talker",
  "Worker model": "Модель Worker",
  "Understands requests, asks questions, and explains progress and results.":
    "Розуміє запити, ставить запитання, пояснює перебіг роботи та результати.",
  "Executes tasks. A model selected in the message box overrides this default for that chat.":
    "Запускає інструменти й редагує файли. Перевизначається вибором моделі в полі вводу.",
  "Use chat model": "Як у чаті",
  "Use main model": "Основна модель",
  "Subagent models": "Моделі субагентів",
  "Choose a default for each role. Unset roles inherit the model of the agent that starts them.":
    "Виберіть модель для кожної ролі. Без окремого вибору використовується модель агента, який запускає субагента.",
  "Use parent model": "Модель батьківського агента",
  Explore: "Дослідження",
  Implement: "Виконання",
  Review: "Перевірка",
  "Find information and understand the task.": "Читання та пошук по коду без внесення змін.",
  "Carry out a focused assignment.": "Локальні правки коду та перевірка.",
  "Check results and identify risks.": "Перевірка diff, граничних випадків і регресій.",
  "Choose an enabled model that supports tools.":
    "Виберіть увімкнену модель із підтримкою інструментів.",
  "Choose a variant available for this model.": "Виберіть варіант, доступний для цієї моделі.",
  "Reasoning level": "Рівень міркування",
  "Model default": "Типовий для моделі",
  "Reasoning is not supported": "Модель не підтримує міркування",
  "Select a model first": "Спочатку виберіть модель",
  "Changing reasoning selects the inherited model for this role.":
    "Зміна рівня міркування закріпить успадковану модель за цією роллю.",
  "Default: no reasoning": "Типово: без міркування",
  "Reasoning is set by the model variant.": "Рівень міркування задано варіантом моделі.",
} as const;
