export default {
  "A deny decision always stops this action. This setting controls unexpected failures only.":
    "Явна заборона завжди зупиняє дію. Це налаштування стосується лише збоїв.",
  "A name you will recognize": "Зрозуміла вам назва",
  Action: "Дія",
  "Action blocked": "Дію заблоковано",
  "Add hook": "Додати хук",
  "All events": "Усі події",
  "Can block the action": "Може зупинити дію",
  "Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.":
    "Перевіряйте інструмент перед запуском, додавайте контекст проєкту або сповіщайте інший сервіс про завершення роботи. Виберіть подію вище, щоб створити перший хук.",
  Conditions: "Умови",
  "Conditions did not match": "Умови не збіглися",
  "Connect your workflow": "Підключіть свій робочий процес",
  "Context added": "Доданий контекст",
  "Continue without waiting. This hook cannot block an action or add context to the current step.":
    "Продовжувати без очікування. Цей хук не може зупинити дію або додати контекст до поточного кроку.",
  Duplicate: "Дублювати",
  "Enable hook {0}": ["Увімкнути хук ", 0, ""],
  "Enter the full hook URL.": "Введіть повний URL хука.",
  "Every occurrence": "За кожної події",
  "Example command": "Приклад команди",
  "Example message": "Приклад повідомлення",
  "Example path": "Приклад шляху",
  Execution: "Виконання",
  Hook: "Хук",
  "Hook failed": "Збій хука",
  "Hook passed": "Хук виконано",
  "Hook timeout must be between 0.1 and 60 seconds.": "Таймаут хука має бути від 0,1 до 60 секунд.",
  "Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.":
    "У межах події хуки виконуються згори вниз. Блокування зупиняє решту хуків.",
  "Move down": "Нижче",
  "Move up": "Вище",
  "Observes only": "Лише спостерігає",
  "Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.":
    "Запускати, лише якщо збіглися всі заповнені умови. Шляхи відносні до папки проєкту; порожнє поле підходить для будь-якого значення.",
  "Run a command": "Запустити команду",
  "Run test": "Запустити перевірку",
  "Run your scripts or send an HTTP request when the agent reaches an event.":
    "Запускайте скрипти або надсилайте HTTP-запит, коли агент досягає потрібної події.",
  "Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.":
    "Запускається в папці проєкту. Дані події надходять як JSON через stdin. Код 0 означає успіх; код 2 забороняє дію, яку можна блокувати.",
  "Send an HTTP request": "Надіслати HTTP-запит",
  "Sends a POST request containing the event data. Your endpoint can return a decision and additional context.":
    "Надсилає POST-запит із даними події. Ваш сервіс може повернути рішення й додатковий контекст.",
  "Stop the action if the hook crashes, times out, or returns an invalid response.":
    "Зупиняти дію, якщо хук завершився з помилкою, перевищив таймаут або повернув некоректну відповідь.",
  Success: "Успіх",
  "Test hook": "Перевірити хук",
  "Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.":
    "Перевіряйте чернетку без збереження. Команда або HTTP-запит справді виконується з прикладом нижче, навіть якщо хук вимкнено.",
  "The hook changed after this test. Run it again to check the current draft.":
    "Після перевірки хук змінився. Запустіть перевірку поточної чернетки знову.",
  "This event has reached its limit of {0} hooks.": [
    "Для цієї події досягнуто ліміту: ",
    0,
    " хуків.",
  ],
  "This event observes an action that already happened. A deny decision has no effect.":
    "Ця подія спостерігає за вже виконаною дією. Рішення про заборону ні на що не впливає.",
  "Timeout, seconds": "Таймаут, секунди",
  "Tool name": "Назва інструмента",
  "Tool result": "Результат інструмента",
  "Untitled hook": "Хук без назви",
  "Update the example or the conditions, then run the test again.":
    "Змініть приклад або умови й запустіть перевірку знову.",
  When: "Коли",
  "Your hooks": "Ваші хуки",
  "{0} conditions": ["Умов: ", 0, ""],
  "{0} copy": ["", 0, ", копія"],
  "{0} enabled": ["Увімкнено: ", 0, ""],
  "Inherited environment variables": "Змінні з оточення застосунку",
  "One variable name per line. Only these extra variables are passed from the app environment.":
    "По одній назві змінної на рядок. З оточення застосунку передаються лише ці додаткові змінні.",
  "Before each run in this session.": "Перед кожним запуском у цій сесії.",
  "Before a user message reaches the model.": "Перед передаванням повідомлення користувача моделі.",
  "Before a tool runs. A denial prevents execution.":
    "Перед запуском інструмента. Заборона запобігає виконанню.",
  "After a tool returns, including failed calls.":
    "Після відповіді інструмента, зокрема в разі помилки.",
  "After a run completes, except cancellation or error.":
    "Після завершення запуску, крім скасування чи помилки.",
  "After each run, including cancellation or error.":
    "Після кожного запуску, зокрема в разі скасування чи помилки.",
  "Before enforcing a tool permission decision. A hook can deny but cannot grant access.":
    "Перед застосуванням рішення про права інструмента. Хук може заборонити дію, але не може надати доступ.",
  "After a summary is generated, before it replaces context.":
    "Після створення підсумку, перед заміною контексту.",
  "When the session emits a notification.": "Коли сесія надсилає сповіщення.",
  "When a subagent starts or finishes. Only the start can be blocked.":
    "Під час запуску або завершення субагента. Заблокувати можна лише запуск.",
  "Before a group of tools runs. Conditions match one tool in the group.":
    "Перед запуском групи інструментів. Усі умови мають збігтися для одного інструмента групи.",
  "Response format": "Формат відповіді",
  "Text output": "Текстовий вивід",
  "JSON decision and context": "Рішення й контекст у JSON",
  "Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.":
    "Підходить для звичайних скриптів і форматерів. Вивід потрапляє до журналу; код 2 усе ще може зупинити дію.",
  "Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.":
    "Поверніть об’єкт JSON із полями decision, reason або additionalContext. Порожній вивід допустимий.",
  "Recent hook activity": "Останні запуски хуків",
  "Actual hook runs in the current task, newest first. Test runs appear in the editor only.":
    "Справжні запуски хуків у поточному завданні, спочатку нові. Перевірки чернеток видно лише в редакторі.",
  "No hooks have run in this task yet.": "У цьому завданні хуки ще не запускалися.",
} as const;
