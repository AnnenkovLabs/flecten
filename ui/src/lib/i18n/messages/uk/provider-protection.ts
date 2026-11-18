export default {
  "Connecting to API {0}": ["Підключення до API ", 0],
  "Hide keys and passwords from this API?": "Приховати ключі та паролі від цього API?",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "Сторонній API-шлюз може зберігати секрети з прочитаних файлів або підміняти виклики інструментів у відповідях.",
  "What protection does": "Як працює захист",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "Діє лише для цього провайдера. Змінити можна у вкладці «Додатково».",
  "Why this warning?": "Чому з’явилося попередження?",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    [
      "Ця адреса схожа на API-шлюз ",
      0,
      ". Сам по собі шлюз не означає загрозу, але його оператор бачить трафік.",
    ],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "Ключ доступу до самого цього API все одно передається для авторизації. Захист маскує лише розпізнані формати секретів.",
  "Continue without protection": "Продовжити без захисту",
  "Enable protection": "Увімкнути захист",
  "Provider protection": "Захист ключів і паролів",
  "Hide keys and passwords from this API": "Приховувати ключі та паролі від цього API",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "Замінює знайдені ключі й токени мітками до відправлення запиту та підставляє реальні значення локально під час редагування і запуску команд.",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "Перед запуском команд, зміною файлів і зверненням до сайтів агент запитає вашого дозволу.",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "Маскує виявлені секрети у вихідних запитах і вимагає підтвердження перед редагуванням файлів, командами та вебзапитами.",
} as const;
