export default {
  "Trust project?": "Доверять проекту?",
  "Trust and continue": "Доверять и продолжить",
  "Project trusted": "Доверие к проекту подтверждено",
  "Configured modules, MCP servers and hooks can run with your account permissions.":
    "Настроенные модули, MCP-серверы и хуки смогут работать с правами вашей учётной записи.",
  "Read files?": "Прочитать файлы?",
  "Change files?": "Изменить файлы?",
  "Run command?": "Выполнить команду?",
  "Access the network?": "Разрешить доступ к сети?",
  "Use connected tool?": "Использовать подключённый инструмент?",
  "Activate skill?": "Активировать навык?",
  "Allow this action?": "Разрешить действие?",
  "More options": "Другие варианты",
  "Add a note (optional)": "Комментарий (необязательно)",
  "Tasks in progress: {0}. Permissions apply to the next action; other settings apply to the next run.":
    [
      "Выполняется задач: ",
      0,
      ". Права применятся к следующему действию, остальные настройки к следующему запуску.",
    ],
  Chat: "Чат",
  "Human approval required every time": "Подтверждение человека требуется каждый раз",
  "Allow bounded built-in actions. Review eligible calls separately; ask when uncertain.":
    "Разрешать безопасные действия в проекте; сомнительные команды проверять и спрашивать при неясности.",
  "Ask unless this exact action was already approved.":
    "Спрашивать, если это точное действие ещё не разрешено.",
  "Allowed for this chat": "Разрешено для этого чата",
  "Permission changed: call denied": "Права изменились: вызов отклонён",
  "Rule could not be saved: call denied": "Правило не сохранено: вызов отклонён",
  "Working directory": "Рабочая папка",
  "Affected paths": "Затрагиваемые пути",
  "Applying decision…": "Применяем решение…",
  "Expired: waiting for confirmation": "Срок истёк: ждём подтверждения",
  "Only identical arguments, paths and working directory will match. You can revoke this rule in Access settings.":
    "Совпасть должны все аргументы, пути и рабочая папка. Отозвать правило можно в разделе «Доступ».",
  "For this chat": "Для этого чата",
  "Save exact rule": "Сохранить точное правило",
  "Remember…": "Запомнить…",
  "Saved rules": "Сохранённые правила",
  "Rules are saved globally. Removing a rule takes effect when you save, including during an active run.":
    "Правила сохраняются глобально. Удаление правила вступает в силу после сохранения, в том числе во время работы агента.",
  "All matching actions": "Все подходящие действия",
  "Exact arguments and resources": "Точные аргументы и ресурсы",
  "Remove rule": "Удалить правило",
  "Destructive actions": "Необратимые действия",
  "Irreversible operations like force push or deleting outside the project.":
    "Необратимые операции вроде force push или удаления вне проекта.",
  "Only the requests shown here are included. New requests remain pending.":
    "Решение касается только показанных запросов. Новые останутся в ожидании.",
  "Feedback for the agent": "Комментарий для агента",
  "OS sandbox available": "Песочница ОС доступна",
  "OS sandbox unavailable": "Песочница ОС недоступна",
  Access: "Доступ",
  "Access mode": "Режим доступа",
  Agent: "Агент",
  "Confirm changes": "Подтверждать изменения",
  "Custom access": "Свой режим доступа",
  "Reads, edits and runs commands in the project. Asks before accessing another folder or destructive actions.":
    "Читает, изменяет файлы и выполняет команды в проекте. Спрашивает перед доступом к другой папке или необратимыми действиями.",
  "Reads freely. Asks before changes, commands and connected tools.":
    "Читает без вопросов. Спрашивает перед изменениями, командами и вызовами подключённых инструментов.",
  "Works across your computer without routine approvals. Process isolation is off.":
    "Работает на всём компьютере без обычных запросов разрешений. Изоляция процессов выключена.",
  "Advanced settings differ from these modes.": "Расширенные настройки отличаются от этих режимов.",
  "Saved rules still apply in every mode.": "Сохранённые правила действуют во всех режимах.",
  "Advanced access settings": "Расширенные настройки доступа",
  "Action permissions": "Разрешения по действиям",
  "Process isolation": "Изоляция процессов",
  "Isolate processes": "Изолировать процессы",
  "Limit commands to the project and approved folders.":
    "Ограничивать команды проектом и разрешёнными папками.",
  "Allow network in isolated commands": "Разрешить сеть в изолированных командах",
  "Allow shell commands inside the sandbox to reach websites and external services.":
    "Разрешить командам в песочнице обращаться к сайтам и внешним сервисам.",
  "Allow folder access?": "Разрешить доступ к папке?",
  "Folder access covers the displayed paths and their subfolders.":
    "Доступ распространяется на указанные папки и все вложенные папки.",
  "Access is shared with agents in this chat.": "Доступ общий для агентов этого чата.",
  "Repeat this action in this chat": "Разрешить в этом чате",
  "Remember folder access": "Запомнить доступ к папке",
} as const;
