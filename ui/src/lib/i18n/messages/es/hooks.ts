export default {
  "A deny decision always stops this action. This setting controls unexpected failures only.":
    "Una denegación siempre detiene esta acción. Esta opción solo controla los fallos inesperados.",
  "A name you will recognize": "Un nombre fácil de reconocer",
  Action: "Acción",
  "Action blocked": "Acción bloqueada",
  "Add hook": "Añadir hook",
  "All events": "Todos los eventos",
  "Can block the action": "Puede bloquear la acción",
  "Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.":
    "Comprueba una herramienta antes de ejecutarla, añade contexto del proyecto o avisa a otro servicio cuando termine el trabajo. Elige un evento para crear tu primer hook.",
  Conditions: "Condiciones",
  "Conditions did not match": "Las condiciones no coinciden",
  "Connect your workflow": "Conecta tu flujo de trabajo",
  "Context added": "Contexto añadido",
  "Continue without waiting. This hook cannot block an action or add context to the current step.":
    "Continúa sin esperar. Este hook no puede bloquear acciones ni añadir contexto al paso actual.",
  Duplicate: "Duplicar",
  "Enable hook {0}": ["Activar hook ", 0, ""],
  "Enter the full hook URL.": "Introduce la URL completa del hook.",
  "Every occurrence": "Cada vez",
  "Example command": "Comando de ejemplo",
  "Example message": "Mensaje de ejemplo",
  "Example path": "Ruta de ejemplo",
  Execution: "Ejecución",
  Hook: "Hook",
  "Hook failed": "El hook ha fallado",
  "Hook passed": "Hook correcto",
  "Hook timeout must be between 0.1 and 60 seconds.":
    "El tiempo de espera debe estar entre 0,1 y 60 segundos.",
  "Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.":
    "Los hooks se ejecutan en orden dentro de cada evento. Una decisión de bloqueo detiene los restantes.",
  "Move down": "Bajar",
  "Move up": "Subir",
  "Observes only": "Solo observa",
  "Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.":
    "Ejecutar solo si coinciden todas las condiciones indicadas. Las rutas son relativas al proyecto; un campo vacío acepta cualquier valor.",
  "Run a command": "Ejecutar un comando",
  "Run test": "Ejecutar prueba",
  "Run your scripts or send an HTTP request when the agent reaches an event.":
    "Ejecuta scripts o envía una solicitud HTTP cuando el agente alcance un evento.",
  "Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.":
    "Se ejecuta en la carpeta del proyecto. Los datos llegan como JSON por stdin. El código 0 indica éxito; el 2 deniega un evento bloqueable.",
  "Send an HTTP request": "Enviar solicitud HTTP",
  "Sends a POST request containing the event data. Your endpoint can return a decision and additional context.":
    "Envía una solicitud POST con los datos del evento. El servicio puede devolver una decisión y contexto adicional.",
  "Stop the action if the hook crashes, times out, or returns an invalid response.":
    "Detiene la acción si el hook falla, agota el tiempo o devuelve una respuesta no válida.",
  Success: "Éxito",
  "Test hook": "Probar hook",
  "Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.":
    "Prueba el borrador sin guardar. El comando o la solicitud HTTP se ejecuta realmente con este ejemplo, aunque el hook esté desactivado.",
  "The hook changed after this test. Run it again to check the current draft.":
    "El hook ha cambiado desde esta prueba. Vuelve a probar el borrador actual.",
  "This event has reached its limit of {0} hooks.": [
    "Este evento ha alcanzado su límite de ",
    0,
    " hooks.",
  ],
  "This event observes an action that already happened. A deny decision has no effect.":
    "Este evento observa una acción ya realizada. Una denegación no tiene efecto.",
  "Timeout, seconds": "Tiempo de espera, segundos",
  "Tool name": "Nombre de herramienta",
  "Tool result": "Resultado de herramienta",
  "Untitled hook": "Hook sin nombre",
  "Update the example or the conditions, then run the test again.":
    "Cambia el ejemplo o las condiciones y repite la prueba.",
  When: "Cuándo",
  "Your hooks": "Tus hooks",
  "{0} conditions": ["", 0, " condiciones"],
  "{0} copy": ["Copia de ", 0, ""],
  "{0} enabled": ["", 0, " activos"],
  "Inherited environment variables": "Variables de entorno heredadas",
  "One variable name per line. Only these extra variables are passed from the app environment.":
    "Un nombre por línea. Solo estas variables adicionales se heredan del entorno de la aplicación.",
  "Before each run in this session.": "Antes de cada ejecución en esta sesión.",
  "Before a user message reaches the model.":
    "Antes de que un mensaje del usuario llegue al modelo.",
  "Before a tool runs. A denial prevents execution.":
    "Antes de ejecutar una herramienta. Una denegación impide la ejecución.",
  "After a tool returns, including failed calls.":
    "Después de la respuesta de una herramienta, incluidos los fallos.",
  "After a run completes, except cancellation or error.":
    "Al finalizar una ejecución, salvo cancelación o error.",
  "After each run, including cancellation or error.":
    "Después de cada ejecución, incluso por cancelación o error.",
  "Before enforcing a tool permission decision. A hook can deny but cannot grant access.":
    "Antes de aplicar una decisión de permisos. El hook puede denegar acceso, pero no concederlo.",
  "After a summary is generated, before it replaces context.":
    "Después de generar el resumen, antes de que sustituya al contexto.",
  "When the session emits a notification.": "Cuando la sesión emite una notificación.",
  "When a subagent starts or finishes. Only the start can be blocked.":
    "Cuando un subagente se inicia o termina. Solo se puede bloquear el inicio.",
  "Before a group of tools runs. Conditions match one tool in the group.":
    "Antes de ejecutar un grupo de herramientas. Las condiciones deben coincidir con una misma herramienta.",
  "Response format": "Formato de respuesta",
  "Text output": "Salida de texto",
  "JSON decision and context": "Decisión y contexto en JSON",
  "Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.":
    "Usa scripts y formateadores normales. La salida es un registro; el código 2 aún puede bloquear una acción.",
  "Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.":
    "Devuelve un objeto JSON con decision, reason o additionalContext. Se acepta una salida vacía.",
  "Recent hook activity": "Actividad reciente de hooks",
  "Actual hook runs in the current task, newest first. Test runs appear in the editor only.":
    "Ejecuciones reales en la tarea actual, de más recientes a más antiguas. Las pruebas solo aparecen en el editor.",
  "No hooks have run in this task yet.": "Todavía no se han ejecutado hooks en esta tarea.",
} as const;
