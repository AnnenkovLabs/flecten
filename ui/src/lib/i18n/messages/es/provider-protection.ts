export default {
  "Connecting to API {0}": ["Conectando con la API ", 0],
  "Hide keys and passwords from this API?": "¿Ocultar secretos enviados a esta API?",
  "Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.":
    "Un relay de API de terceros puede registrar secretos de archivos leídos o alterar llamadas a herramientas.",
  "What protection does": "Cómo funciona la protección",
  "AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.":
    "Reemplaza claves y tokens detectados por marcadores antes de enviar la solicitud y restaura los valores reales localmente.",
  "The agent asks for your approval before running commands, changing files or visiting websites.":
    "El agente te pide permiso antes de ejecutar comandos, cambiar archivos o visitar sitios web.",
  "Applies only to this API. You can turn it off later in its Advanced tab.":
    "Solo se aplica a este proveedor. Puedes cambiarlo en su pestaña Avanzado.",
  "Why this warning?": "¿Por qué aparece este aviso?",
  "This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.":
    [
      "Este endpoint coincide con ",
      0,
      ", una pasarela relay de API. No implica malicia, pero su operador puede inspeccionar el tráfico.",
    ],
  "The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.":
    "La clave de acceso de esta API sí se envía para autenticar. El enmascarado cubre solo formatos de secretos reconocidos.",
  "Continue without protection": "Continuar sin protección",
  "Enable protection": "Activar protección",
  "Provider protection": "Protección de claves y contraseñas",
  "Hide keys and passwords from this API": "Ocultar secretos enviados a esta API",
  "Hides detected secrets from AI. The agent asks for your approval before running commands, changing files or visiting websites.":
    "Enmascara secretos detectados en solicitudes salientes y pide aprobación antes de editar, ejecutar comandos o abrir webs.",
} as const;
