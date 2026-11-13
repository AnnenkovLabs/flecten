export default {
  "A deny decision always stops this action. This setting controls unexpected failures only.":
    "Uma decisão de negação sempre interrompe esta ação. Esta opção só controla falhas inesperadas.",
  "A name you will recognize": "Um nome fácil de reconhecer",
  Action: "Ação",
  "Action blocked": "Ação bloqueada",
  "Add hook": "Adicionar hook",
  "All events": "Todos os eventos",
  "Can block the action": "Pode bloquear a ação",
  "Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.":
    "Verifique uma ferramenta antes de executá-la, adicione contexto do projeto ou avise outro serviço ao concluir. Escolha um evento para criar seu primeiro hook.",
  Conditions: "Condições",
  "Conditions did not match": "As condições não correspondem",
  "Connect your workflow": "Conecte seu fluxo de trabalho",
  "Context added": "Contexto adicionado",
  "Continue without waiting. This hook cannot block an action or add context to the current step.":
    "Continua sem esperar. Este hook não pode bloquear ações nem adicionar contexto à etapa atual.",
  Duplicate: "Duplicar",
  "Enable hook {0}": ["Ativar hook ", 0, ""],
  "Enter the full hook URL.": "Digite a URL completa do hook.",
  "Every occurrence": "A cada ocorrência",
  "Example command": "Exemplo de comando",
  "Example message": "Exemplo de mensagem",
  "Example path": "Exemplo de caminho",
  Execution: "Execução",
  Hook: "Hook",
  "Hook failed": "Falha no hook",
  "Hook passed": "Hook aprovado",
  "Hook timeout must be between 0.1 and 60 seconds.":
    "O tempo limite deve ficar entre 0,1 e 60 segundos.",
  "Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.":
    "Os hooks são executados em ordem em cada evento. Uma decisão de bloqueio interrompe os restantes.",
  "Move down": "Mover para baixo",
  "Move up": "Mover para cima",
  "Observes only": "Apenas observa",
  "Only run when every filled condition matches. Paths are relative to the project folder; an empty field matches everything.":
    "Executa somente se todas as condições preenchidas corresponderem. Caminhos são relativos ao projeto; um campo vazio aceita qualquer valor.",
  "Run a command": "Executar um comando",
  "Run test": "Executar teste",
  "Run your scripts or send an HTTP request when the agent reaches an event.":
    "Execute scripts ou envie uma solicitação HTTP quando o agente alcançar um evento.",
  "Runs in the project folder. Event data arrives as JSON on stdin. Exit 0 succeeds; exit 2 denies a blocking event.":
    "Executa na pasta do projeto. Os dados chegam como JSON via stdin. O código 0 indica sucesso; o 2 nega um evento que pode ser bloqueado.",
  "Send an HTTP request": "Enviar solicitação HTTP",
  "Sends a POST request containing the event data. Your endpoint can return a decision and additional context.":
    "Envia uma solicitação POST com os dados do evento. Seu serviço pode retornar uma decisão e contexto adicional.",
  "Stop the action if the hook crashes, times out, or returns an invalid response.":
    "Interrompe a ação se o hook falhar, exceder o tempo limite ou retornar uma resposta inválida.",
  Success: "Sucesso",
  "Test hook": "Testar hook",
  "Test this draft without saving. The command or HTTP request really runs using the example below, even if the hook is disabled.":
    "Teste o rascunho sem salvar. O comando ou a solicitação HTTP é executado de verdade com este exemplo, mesmo com o hook desativado.",
  "The hook changed after this test. Run it again to check the current draft.":
    "O hook mudou após este teste. Teste novamente o rascunho atual.",
  "This event has reached its limit of {0} hooks.": [
    "Este evento atingiu o limite de ",
    0,
    " hooks.",
  ],
  "This event observes an action that already happened. A deny decision has no effect.":
    "Este evento observa uma ação já realizada. Uma decisão de negação não tem efeito.",
  "Timeout, seconds": "Tempo limite, segundos",
  "Tool name": "Nome da ferramenta",
  "Tool result": "Resultado da ferramenta",
  "Untitled hook": "Hook sem nome",
  "Update the example or the conditions, then run the test again.":
    "Atualize o exemplo ou as condições e execute o teste novamente.",
  When: "Quando",
  "Your hooks": "Seus hooks",
  "{0} conditions": ["", 0, " condições"],
  "{0} copy": ["Cópia de ", 0, ""],
  "{0} enabled": ["", 0, " ativos"],
  "Inherited environment variables": "Variáveis de ambiente herdadas",
  "One variable name per line. Only these extra variables are passed from the app environment.":
    "Um nome por linha. Somente estas variáveis extras são herdadas do ambiente do aplicativo.",
  "Before each run in this session.": "Antes de cada execução nesta sessão.",
  "Before a user message reaches the model.": "Antes de uma mensagem do usuário chegar ao modelo.",
  "Before a tool runs. A denial prevents execution.":
    "Antes de uma ferramenta executar. Uma negação impede a execução.",
  "After a tool returns, including failed calls.":
    "Após a resposta de uma ferramenta, incluindo falhas.",
  "After a run completes, except cancellation or error.":
    "Ao concluir uma execução, exceto por cancelamento ou erro.",
  "After each run, including cancellation or error.":
    "Após cada execução, incluindo cancelamento ou erro.",
  "Before enforcing a tool permission decision. A hook can deny but cannot grant access.":
    "Antes de aplicar uma decisão de permissão. O hook pode negar acesso, mas não concedê-lo.",
  "After a summary is generated, before it replaces context.":
    "Após gerar um resumo, antes de substituir o contexto.",
  "When the session emits a notification.": "Quando a sessão emite uma notificação.",
  "When a subagent starts or finishes. Only the start can be blocked.":
    "Quando um subagente inicia ou termina. Apenas o início pode ser bloqueado.",
  "Before a group of tools runs. Conditions match one tool in the group.":
    "Antes de executar um grupo de ferramentas. As condições devem corresponder à mesma ferramenta do grupo.",
  "Response format": "Formato da resposta",
  "Text output": "Saída de texto",
  "JSON decision and context": "Decisão e contexto em JSON",
  "Use ordinary scripts and formatters. Output is a log; exit code 2 can still block an action.":
    "Use scripts e formatadores comuns. A saída é um registro; o código 2 ainda pode bloquear uma ação.",
  "Return a JSON object with decision, reason, or additionalContext. Empty output is accepted.":
    "Retorne um objeto JSON com decision, reason ou additionalContext. Saída vazia é aceita.",
  "Recent hook activity": "Atividade recente dos hooks",
  "Actual hook runs in the current task, newest first. Test runs appear in the editor only.":
    "Execuções reais na tarefa atual, das mais recentes às mais antigas. Os testes aparecem apenas no editor.",
  "No hooks have run in this task yet.": "Nenhum hook foi executado nesta tarefa ainda.",
} as const;
