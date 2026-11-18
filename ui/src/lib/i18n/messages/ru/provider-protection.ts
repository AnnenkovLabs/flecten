export default {
  "Connecting to API {0}": ["Подключение к API ", 0],
  "Hide keys and passwords from this API?": "Скрыть ключи и пароли от этого API?",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "Сторонний API-шлюз может сохранять секреты из прочитанных файлов или подменять вызовы инструментов в ответах.",
  "What protection does": "Как работает защита",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "Действует только для этого провайдера. Изменить можно во вкладке «Дополнительно».",
  "Why this warning?": "Почему появилось предупреждение?",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    [
      "Этот адрес похож на API-шлюз ",
      0,
      ". Сам по себе шлюз не означает угрозу, но его оператор видит трафик.",
    ],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "Ключ доступа к самому этому API всё равно передаётся для авторизации. Защита маскирует только распознанные форматы секретов.",
  "Continue without protection": "Продолжить без защиты",
  "Enable protection": "Включить защиту",
  "Provider protection": "Защита ключей и паролей",
  "Hide keys and passwords from this API": "Скрывать ключи и пароли от этого API",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "Заменяет найденные ключи и токены метками до отправки запроса и подставляет реальные значения локально при правке файлов и запуске команд.",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "Перед запуском команд, правкой файлов и обращением к сайтам агент спросит ваше разрешение.",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "Маскирует обнаруженные секреты в исходящих запросах и требует подтверждения перед правкой файлов, командами и веб-запросами.",
} as const;
