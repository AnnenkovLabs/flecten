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
  "Only this action in this folder.": "Только это действие в этой папке.",
  "Tasks in progress: {0}. Permissions apply to the next action; other settings apply to the next run.":
    [
      "Выполняется задач: ",
      0,
      ". Права применятся к следующему действию, остальные настройки к следующему запуску.",
    ],
  Chat: "Чат",
  "Always ask a person": "Всегда спрашивать человека",
  "These checkpoints cannot be bypassed by saved approvals or automatic review.":
    "Эти подтверждения нельзя обойти сохранённым разрешением или автоматической проверкой.",
  "Human approval required every time": "Подтверждение человека требуется каждый раз",
  "Allow bounded built-in actions. Review eligible calls separately; ask when uncertain.":
    "Разрешать ограниченные встроенные действия. Остальные допустимые вызовы проверять отдельно, при сомнении спрашивать.",
  "Ask unless this exact action was already approved.":
    "Спрашивать, если это точное действие ещё не разрешено.",
  "Allowed for this chat": "Разрешено для этого чата",
  "Permission changed: call denied": "Права изменились: вызов отклонён",
  "Rule could not be saved: call denied": "Правило не сохранено: вызов отклонён",
  "Working directory": "Рабочая папка",
  "Affected paths": "Затрагиваемые пути",
  "Applying decision…": "Применяем решение…",
  "Expired: waiting for confirmation": "Срок истёк: ждём подтверждения",
  "Save this exact action for this project?": "Сохранить это точное действие для проекта?",
  "Only identical arguments, paths and working directory will match. You can revoke this rule in Permissions.":
    "Совпасть должны все аргументы, пути и рабочая папка. Отозвать правило можно в разделе разрешений.",
  "For this chat": "Для этого чата",
  "Save exact rule": "Сохранить точное правило",
  "Remember…": "Запомнить…",
  "Allow bounded built-in actions. Ask before arbitrary code or external tools.":
    "Разрешать ограниченные встроенные действия. Спрашивать перед произвольным кодом и внешними инструментами.",
  "Allows ordinary actions. Destructive rules and sandbox limits still apply.":
    "Разрешает обычные действия. Правила опасных операций и ограничения песочницы продолжают действовать.",
  "Saved rules": "Сохранённые правила",
  "Rules belong to this project. Removing a rule takes effect when you save, including during an active run.":
    "Правила принадлежат этому проекту. Удаление применяется после сохранения, в том числе во время работы агента.",
  "No saved rules.": "Нет сохранённых правил.",
  "All matching actions": "Все подходящие действия",
  "Exact arguments and resources": "Точные аргументы и ресурсы",
  "Configured scope": "Заданный охват",
  "Remove rule": "Удалить правило",
  "Destructive actions": "Необратимые действия",
  "A separate checkpoint for irreversible operations, even when ordinary actions are allowed.":
    "Отдельное подтверждение необратимых операций, даже если обычные действия разрешены.",
  "Execution boundary": "Граница исполнения",
  "Sandbox limits apply independently of permissions. External paths stay blocked while workspace isolation is enabled.":
    "Ограничения песочницы действуют независимо от разрешений. Внешние пути заблокированы, пока включена изоляция рабочей папки.",
  "Workspace isolation enabled": "Изоляция рабочей папки включена",
  "Workspace isolation disabled": "Изоляция рабочей папки выключена",
  "Only the requests shown here are included. New requests remain pending.":
    "Решение касается только показанных запросов. Новые останутся в ожидании.",
  "What should the agent do instead? (optional)":
    "Что агенту сделать вместо этого? (необязательно)",
  "Feedback for the agent": "Комментарий для агента",
  "OS sandbox available": "Песочница ОС доступна",
  "OS sandbox unavailable": "Песочница ОС недоступна",
} as const;
