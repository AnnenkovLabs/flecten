export default {
  "A deny decision always stops this action. This setting controls unexpected failures only.":
    "Явный запрет всегда останавливает действие. Эта настройка относится только к сбоям.",
  "A name you will recognize": "Понятное вам название",
  Action: "Действие",
  "Action blocked": "Действие заблокировано",
  "Add hook": "Добавить хук",
  "All events": "Все события",
  "Can block the action": "Может остановить действие",
  "Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.":
    "Проверяйте инструмент перед запуском, добавляйте контекст проекта или уведомляйте другой сервис о завершении работы. Выберите событие выше, чтобы создать первый хук.",
  Conditions: "Условия",
  "Conditions did not match": "Условия не совпали",
  "Connect your workflow": "Подключите свой рабочий процесс",
  "Context added": "Добавленный контекст",
  "Continue without waiting. This hook cannot block an action or add context to the current step.":
    "Продолжать без ожидания. Этот хук не может остановить действие или добавить контекст в текущий шаг.",
  Duplicate: "Дублировать",
  "Enable hook {0}": ["Включить хук ", 0, ""],
  "Enter the full hook URL.": "Введите полный URL хука.",
  "Every occurrence": "При каждом событии",
  "Example command": "Пример команды",
  "Example message": "Пример сообщения",
  "Example path": "Пример пути",
  Execution: "Выполнение",
  Hook: "Хук",
  "Hook failed": "Сбой хука",
  "Hook passed": "Хук выполнен",
  "Hook timeout must be between 0.1 and 60 seconds.":
    "Таймаут хука должен быть от 0,1 до 60 секунд.",
  "Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.":
    "Внутри события хуки выполняются сверху вниз. Блокировка останавливает оставшиеся хуки.",
  "Move down": "Ниже",
  "Move up": "Выше",
  "Observes only": "Только наблюдает",
  "Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.":
    "Запускать, только если совпали все заполненные условия. Пути считаются от папки проекта; пустое поле подходит для любого значения.",
  "Run a command": "Запустить команду",
  "Run test": "Запустить проверку",
  "Run your scripts or send an HTTP request when the agent reaches an event.":
    "Запускайте скрипты или отправляйте HTTP-запрос, когда агент достигает нужного события.",
  "Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.":
    "Запускается в папке проекта. Данные события приходят как JSON через stdin. Код 0 означает успех; код 2 запрещает блокируемое действие.",
  "Send an HTTP request": "Отправить HTTP-запрос",
  "Sends a POST request containing the event data. Your endpoint can return a decision and additional context.":
    "Отправляет POST-запрос с данными события. Ваш сервис может вернуть решение и дополнительный контекст.",
  "Stop the action if the hook crashes, times out, or returns an invalid response.":
    "Останавливать действие, если хук завершился с ошибкой, превысил таймаут или вернул некорректный ответ.",
  Success: "Успех",
  "Test hook": "Проверить хук",
  "Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.":
    "Проверяйте черновик без сохранения. Команда или HTTP-запрос действительно выполняется с примером ниже, даже если хук выключен.",
  "The hook changed after this test. Run it again to check the current draft.":
    "После проверки хук изменился. Запустите проверку текущего черновика снова.",
  "This event has reached its limit of {0} hooks.": [
    "Для этого события достигнут лимит: ",
    0,
    " хуков.",
  ],
  "This event observes an action that already happened. A deny decision has no effect.":
    "Это событие наблюдает за уже выполненным действием. Решение о запрете ни на что не влияет.",
  "Timeout, seconds": "Таймаут, секунды",
  "Tool name": "Имя инструмента",
  "Tool result": "Результат инструмента",
  "Untitled hook": "Хук без названия",
  "Update the example or the conditions, then run the test again.":
    "Измените пример или условия и запустите проверку снова.",
  When: "Когда",
  "Your hooks": "Ваши хуки",
  "{0} conditions": ["Условий: ", 0, ""],
  "{0} copy": ["", 0, ", копия"],
  "{0} enabled": ["Включено: ", 0, ""],
  "Inherited environment variables": "Переменные из окружения приложения",
  "One variable name per line. Only these extra variables are passed from the app environment.":
    "По одному имени переменной на строку. Из окружения приложения передаются только эти дополнительные переменные.",
  "Before each run in this session.": "Перед каждым запуском в этой сессии.",
  "Before a user message reaches the model.": "Перед передачей сообщения пользователя модели.",
  "Before a tool runs. A denial prevents execution.":
    "Перед запуском инструмента. Запрет предотвращает выполнение.",
  "After a tool returns, including failed calls.":
    "После ответа инструмента, в том числе при ошибке.",
  "After a run completes, except cancellation or error.":
    "После завершения запуска, кроме отмены или ошибки.",
  "After each run, including cancellation or error.":
    "После каждого запуска, в том числе при отмене или ошибке.",
  "Before enforcing a tool permission decision. A hook can deny but cannot grant access.":
    "Перед применением решения о правах инструмента. Хук может запретить действие, но не может выдать доступ.",
  "After a summary is generated, before it replaces context.":
    "После создания выжимки, перед заменой контекста.",
  "When the session emits a notification.": "При уведомлении от сессии.",
  "When a subagent starts or finishes. Only the start can be blocked.":
    "При запуске или завершении субагента. Заблокировать можно только запуск.",
  "Before a group of tools runs. Conditions match one tool in the group.":
    "Перед запуском группы инструментов. Все условия должны совпасть у одного инструмента группы.",
  "Response format": "Формат ответа",
  "Text output": "Текстовый вывод",
  "JSON decision and context": "Решение и контекст в JSON",
  "Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.":
    "Подходит для обычных скриптов и форматтеров. Вывод попадает в журнал; код 2 по-прежнему может остановить действие.",
  "Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.":
    "Верните объект JSON с полями decision, reason или additionalContext. Пустой вывод допустим.",
  "Recent hook activity": "Последние запуски хуков",
  "Actual hook runs in the current task, newest first. Test runs appear in the editor only.":
    "Реальные запуски хуков в текущей задаче, сначала новые. Проверки черновиков видны только в редакторе.",
  "No hooks have run in this task yet.": "В этой задаче хуки ещё не запускались.",
} as const;
