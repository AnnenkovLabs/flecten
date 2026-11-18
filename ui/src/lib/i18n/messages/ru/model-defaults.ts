export default {
  "Main model": "Основная модель",
  "Default main model": "Основная модель по умолчанию",
  "Used when Talker and Worker is off, and as the fallback for role defaults.":
    "Используется в одноагентных чатах и для ролей со значением по умолчанию.",
  "Defaults apply to new chats. You can still choose a model in the message box.":
    "Применяется к новым чатам. Для отдельного чата модель выбирается в поле ввода.",
  "Talker handles your conversation. Worker carries out tasks with tools, for any kind of work.":
    "Talker отвечает в диалоге без ожидания, пока Worker запускает инструменты и правит файлы в отдельной сессии.",
  "Talker model": "Модель Talker",
  "Worker model": "Модель Worker",
  "Understands requests, asks questions, and explains progress and results.":
    "Понимает запросы, задаёт вопросы, объясняет ход работы и результаты.",
  "Executes tasks. A model selected in the message box overrides this default for that chat.":
    "Запускает инструменты и правит файлы. Переопределяется выбором модели в поле ввода.",
  "Use chat model": "Как в чате",
  "Use main model": "Основная модель",
  "Subagent models": "Модели субагентов",
  "Choose a default for each role. Unset roles inherit the model of the agent that starts them.":
    "Выберите модель для каждой роли. Без отдельного выбора используется модель агента, который запускает субагента.",
  "Use parent model": "Модель родителя",
  Explore: "Исследование",
  Implement: "Выполнение",
  Review: "Проверка",
  "Find information and understand the task.": "Чтение и поиск по коду без внесения изменений.",
  "Carry out a focused assignment.": "Локальные правки кода и проверка.",
  "Check results and identify risks.": "Проверка diff, граничных случаев и регрессий.",
  "Choose an enabled model that supports tools.":
    "Выберите включённую модель с поддержкой инструментов.",
  "Choose a variant available for this model.": "Выберите вариант, доступный для этой модели.",
  "Reasoning level": "Уровень рассуждений",
  "Model default": "По умолчанию для модели",
  "Reasoning is not supported": "Модель не поддерживает рассуждения",
  "Select a model first": "Сначала выберите модель",
  "Changing reasoning selects the inherited model for this role.":
    "Изменение уровня рассуждений закрепит наследуемую модель за этой ролью.",
  "Default: no reasoning": "По умолчанию: без рассуждений",
  "Reasoning is set by the model variant.": "Уровень рассуждений задан вариантом модели.",
} as const;
