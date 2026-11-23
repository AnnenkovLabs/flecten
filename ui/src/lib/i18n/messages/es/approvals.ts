export default {
  "Trust project?": "¿Confiar en el proyecto?",
  "Trust and continue": "Confiar y continuar",
  "Project trusted": "Proyecto de confianza",
  "Configured modules, MCP servers and hooks can run with your account permissions.":
    "Los módulos, servidores MCP y hooks configurados podrán ejecutarse con los permisos de tu cuenta.",
  "Read files?": "¿Leer archivos?",
  "Change files?": "¿Modificar archivos?",
  "Run command?": "¿Ejecutar comando?",
  "Access the network?": "¿Acceder a la red?",
  "Use connected tool?": "¿Usar herramienta conectada?",
  "Activate skill?": "¿Activar habilidad?",
  "Allow this action?": "¿Permitir esta acción?",
  "More options": "Más opciones",
  "Add a note (optional)": "Añadir nota (opcional)",
  "Tasks in progress: {0}. Permissions apply to the next action; other settings apply to the next run.":
    [
      "Tareas en curso: ",
      0,
      ". Los permisos se aplican a la siguiente acción; los demás ajustes, a la siguiente ejecución.",
    ],
  Chat: "Chat",
  "Human approval required every time": "Se requiere aprobación humana cada vez",
  "Allow bounded built-in actions. Review eligible calls separately; ask when uncertain.":
    "Permite acciones seguras en el proyecto; revisa comandos ambiguos y pregunta si hay dudas.",
  "Ask unless this exact action was already approved.":
    "Preguntar salvo que esta acción exacta ya esté aprobada.",
  "Allowed for this chat": "Permitido para este chat",
  "Permission changed: call denied": "Permisos modificados: llamada denegada",
  "Rule could not be saved: call denied": "No se guardó la regla: llamada denegada",
  "Working directory": "Directorio de trabajo",
  "Affected paths": "Rutas afectadas",
  "Applying decision…": "Aplicando decisión…",
  "Expired: waiting for confirmation": "Caducó: esperando confirmación",
  "Only identical arguments, paths and working directory will match. You can revoke this rule in Access settings.":
    "Deben coincidir todos los argumentos, rutas y el directorio de trabajo. Puedes revocar la regla en Acceso.",
  "For this chat": "Para este chat",
  "Save exact rule": "Guardar regla exacta",
  "Remember…": "Recordar…",
  "Saved rules": "Reglas guardadas",
  "Rules are saved globally. Removing a rule takes effect when you save, including during an active run.":
    "Las reglas se guardan globalmente. Al guardar, las reglas eliminadas dejan de aplicarse, incluso durante una ejecución.",
  "All matching actions": "Todas las acciones coincidentes",
  "Exact arguments and resources": "Argumentos y recursos exactos",
  "Remove rule": "Eliminar regla",
  "Destructive actions": "Acciones irreversibles",
  "Irreversible operations like force push or deleting outside the project.":
    "Operaciones irreversibles como force push o borrar archivos fuera del proyecto.",
  "Only the requests shown here are included. New requests remain pending.":
    "Solo se incluyen las solicitudes mostradas. Las nuevas quedarán pendientes.",
  "Feedback for the agent": "Comentario para el agente",
  "OS sandbox available": "Entorno aislado del SO disponible",
  "OS sandbox unavailable": "Entorno aislado del SO no disponible",
  Access: "Acceso",
  "Access mode": "Modo de acceso",
  Agent: "Agente",
  "Confirm changes": "Confirmar cambios",
  "Custom access": "Acceso personalizado",
  "Reads, edits and runs commands in the project. Asks before accessing another folder or destructive actions.":
    "Lee, edita y ejecuta comandos en el proyecto. Pide permiso para acceder a otra carpeta o realizar acciones irreversibles.",
  "Reads freely. Asks before changes, commands and connected tools.":
    "Lee sin preguntar. Pide permiso para cambios, comandos y herramientas conectadas.",
  "Works across your computer without routine approvals. Process isolation is off.":
    "Trabaja en todo el equipo sin pedir permisos de rutina. El aislamiento de procesos está desactivado.",
  "Advanced settings differ from these modes.": "La configuración avanzada difiere de estos modos.",
  "Saved rules still apply in every mode.": "Las reglas guardadas se aplican en todos los modos.",
  "Advanced access settings": "Configuración avanzada de acceso",
  "Action permissions": "Permisos por acción",
  "Process isolation": "Aislamiento de procesos",
  "Isolate processes": "Aislar procesos",
  "Limit commands to the project and approved folders.":
    "Limitar los comandos al proyecto y las carpetas autorizadas.",
  "Allow network in isolated commands": "Permitir red en comandos aislados",
  "Allow shell commands inside the sandbox to reach websites and external services.":
    "Permitir que los comandos dentro del entorno aislado accedan a sitios web y servicios externos.",
  "Allow folder access?": "¿Permitir acceso a la carpeta?",
  "Folder access covers the displayed paths and their subfolders.":
    "El acceso abarca las rutas indicadas y sus subcarpetas.",
  "Access is shared with agents in this chat.":
    "El acceso se comparte con los agentes de este chat.",
  "Repeat this action in this chat": "Permitir en este chat",
  "Remember folder access": "Recordar acceso a la carpeta",
} as const;
