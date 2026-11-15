// Plain interface copy. Keep runtime values as numeric parts.
export default {
  "Refresh models every hour": "Обновлять модели каждый час",
  "Update all models and their capabilities while the app is open. Manual edits are kept by default.":
    "Пока приложение открыто, обновлять все модели и их возможности. Ручные правки сохраняются по умолчанию.",
  "Overwrite manual model edits": "Перезаписывать ручные правки моделей",
  "Allow automatic updates to replace model details you changed manually.":
    "Разрешить автообновлению заменять характеристики моделей, которые вы изменили вручную.",
  "Refresh model details": "Обновить данные модели",
  "Unknown limits stay blank. Enter them manually if needed.":
    "Неизвестные лимиты оставлены пустыми. При необходимости укажите их вручную.",
  "Model to test": "Модель для проверки",
  "Test connection": "Проверить подключение",
  "Fix the API address.": "Исправьте адрес API.",
  "Testing text output from the model{0}. The draft will not be saved.": [
    "Проверяется текстовый ответ модели",
    0,
    ". Черновик не сохраняется.",
  ],
  "Text: response received": "Текст: ответ получен",
  "Connection error": "Ошибка подключения",
  "· {0} ms": ["· ", 0, " мс"],
  "{0}Tools were not tested.": [0, "Инструменты не проверялись."],
  "Replay, reasoning, cache, strict tools.":
    "Повторная передача, рассуждения, кеш, строгий режим инструментов.",
  "Preserve reasoning (Qwen)": "Сохранять рассуждения (Qwen)",
  available: "есть",
  visible: "видны",
} as const;
