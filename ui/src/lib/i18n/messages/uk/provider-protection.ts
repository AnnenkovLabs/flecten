export default {
  "Connecting to API {0}": ["Підключення API: ", 0],
  "Hide keys and passwords from this API?": "Приховати ключі та паролі від цього API?",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "Без захисту власник API може зберегти ключі та паролі з файлів, які читає агент, або підмінити відповідь ШІ, щоб агент виконав небезпечну команду.",
  "What protection does": "Як працює захист",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "Працює лише для цього API. Вимкнути захист можна на вкладці «Додатково».",
  "Why this warning?": "Чому з’явилося попередження?",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    [
      "Цей API, схоже, використовує ",
      0,
      ", програму-посередник для запитів до ШІ. Це не означає, що його власник зловмисник.",
    ],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "Ключ для підключення до цього API все одно передається його власнику. Захист приховує лише ті секрети, які зміг розпізнати.",
  "Continue without protection": "Продовжити без захисту",
  "Enable protection": "Увімкнути захист",
  "Provider protection": "Захист ключів і паролів",
  "Hide keys and passwords from this API": "Приховувати ключі та паролі від цього API",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "ШІ побачить позначки замість знайдених ключів і паролів. У командах і змінах файлів застосунок підставить справжні значення.",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "Перед запуском команд, зміною файлів і зверненням до сайтів агент запитає вашого дозволу.",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "Приховує знайдені секрети від ШІ. Перед запуском команд, зміною файлів і зверненням до сайтів агент запитає вашого дозволу.",
} as const;
