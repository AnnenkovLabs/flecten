export default {
  "Connecting to API {0}": ["Подключение АПИ: ", 0],
  "Hide keys and passwords from this API?": "Скрыть ключи и пароли от этого АПИ?",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "Без защиты владелец АПИ может сохранить ключи и пароли из файлов, которые читает агент, или подменить ответ ИИ, чтобы агент выполнил опасную команду.",
  "What protection does": "Как работает защита",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "Работает только для этого АПИ. Отключить защиту можно во вкладке «Дополнительно».",
  "Why this warning?": "Почему появилось предупреждение?",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    [
      "Этот АПИ, похоже, использует ",
      0,
      ", программу-посредник для запросов к ИИ. Это не означает, что его владелец злоумышленник.",
    ],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "Ключ для подключения к этому АПИ всё равно передаётся его владельцу. Защита скрывает только те секреты, которые смогла распознать.",
  "Continue without protection": "Продолжить без защиты",
  "Enable protection": "Включить защиту",
  "Provider protection": "Защита ключей и паролей",
  "Hide keys and passwords from this API": "Скрывать ключи и пароли от этого АПИ",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "ИИ увидит метки вместо найденных ключей и паролей. В командах и правках приложение подставит настоящие значения.",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "Перед запуском команд, правкой файлов и обращением к сайтам агент спросит ваше разрешение.",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "Скрывает найденные секреты от ИИ. Перед запуском команд, правкой файлов и обращением к сайтам агент спросит ваше разрешение.",
} as const;
