// Plain interface copy. Keep runtime values as numeric parts.
export default {
  "Auto-compaction at {0}%": ["Compactación automática al ", 0, " %"],
  "Input tokens": "Tokens de entrada",
  "Output tokens": "Tokens de salida",
  "Reasoning tokens": "Tokens de razonamiento",
  "Cache read tokens": "Tokens leídos de la caché",
  "Cache write tokens": "Tokens escritos en la caché",
  "Token usage": "Uso de tokens",
  "Not reported": "No informado",
  session: "sesión",
  "last turn": "último turno",
  "Usage by model": "Uso por modelo",
  "Input / output tokens": "Tokens de entrada / salida",
  "Worker activity": "Actividad de Worker",
  "No tool calls yet": "Todavía no hay llamadas a herramientas",
  "Stop Worker": "Detener Worker",
  "Talker and Worker": "Talker y Worker",
  "Separate conversation from execution": "Separar la conversación de la ejecución",
  "New chats use a Talker and an independent Worker. Both use the selected model. English handoffs replace automatic translation; tool output stays live.":
    "Divide los nuevos chats en dos sesiones: Talker mantiene la conversación mientras Worker edita archivos y ejecuta comandos.",
  Undo: "Deshacer",
  Redo: "Rehacer",
  "Worker failed": "Worker falló",
  "Call interrupted; completion was not confirmed":
    "Llamada interrumpida; no se confirmó que se completara",
} as const;
