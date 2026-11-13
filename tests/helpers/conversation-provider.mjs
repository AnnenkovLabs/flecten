/** Deterministic provider scenario exercised by the real app and real command runner. */
const inspection = Promise.withResolvers();
const commentary = Promise.withResolvers();
let workerPageStarted = false;
let workerPageCompleted = false;

export async function conversationReply(body) {
  const system = body.messages?.find((message) => message.role === "system")?.content ?? "";
  const messages = body.messages ?? [];
  if (!body.tools?.length) {
    return {
      text: JSON.stringify({
        progress: "The verification command completed successfully with exit code 0.",
        locations: "README.md and the project verification command.",
        instructions: "Preserve the requested public API.",
        nextSteps: "Report verified results to the Talker.",
        risks: "No unresolved failures were recorded.",
      }),
    };
  }
  if (system.includes("# Flecten Worker")) {
    const lifecycle = body.tools?.some((tool) => tool.function?.name === "context");
    if (lifecycle && !workerPageStarted) {
      workerPageStarted = true;
      return {
        calls: [
          {
            id: "worker-page-begin",
            name: "context",
            arguments: {
              op: "begin",
              title: "Project verification",
              objective: "Read project guidance and verify the requested public API.",
            },
          },
        ],
      };
    }
    if (workerPageCompleted) {
      return {
        text: "<summary>## Verification\nThe command completed successfully.\n- Exit code: 0\n- Preserved the requested API.</summary>",
      };
    }
    if (
      !messages.some((message) => message.role === "tool" && message.tool_call_id === "worker-read")
    ) {
      return {
        calls: [
          { id: "worker-read", name: "read", arguments: { path: "README.md" } },
          { id: "worker-glob", name: "glob", arguments: { pattern: "*.md" } },
        ],
      };
    }
    if (
      !messages.some(
        (message) => message.role === "tool" && message.tool_call_id === "worker-command",
      )
    ) {
      inspection.resolve();
      await commentary.promise;
      return {
        calls: [
          {
            id: "worker-command",
            name: "bash",
            arguments: {
              command:
                "printf 'WORKER_STREAM_BEGIN\\n'; while [ ! -f worker-release ]; do printf 'WORKER_LIVE_OUTPUT\\n'; sleep 0.2; done; printf 'WORKER_STREAM_END\\n'",
            },
          },
        ],
      };
    }
    workerPageCompleted = true;
    return lifecycle
      ? {
          calls: [
            {
              id: "worker-page-complete",
              name: "context",
              arguments: {
                op: "complete",
                summary: "Project verification finished.",
                evidence: ["The command returned exit code 0 and WORKER_STREAM_END."],
                next: "Report the verified result to the Talker.",
              },
            },
          ],
        }
      : {
          text: "<summary>## Verification\nThe command completed successfully.\n- Exit code: 0\n- Preserved the requested API.</summary>",
        };
  }
  if (!system.includes("# Flecten Talker")) return undefined;
  if (
    !messages.some((message) =>
      message.tool_calls?.some((call) => call.function?.name === "worker"),
    )
  ) {
    return {
      text: "Сначала проверю документацию.",
      calls: [
        {
          id: "start-worker",
          name: "worker",
          arguments: {
            operation: "start",
            task: "Run the project verification command. Preserve the public API and report actual results.",
          },
        },
      ],
    };
  }
  const latest = messages.findLast((message) => message.role === "user")?.content ?? "";
  if (
    !messages.some((message) => message.tool_calls?.some((call) => call.id === "inspect-worker"))
  ) {
    await inspection.promise;
    return {
      text: "Документация прочитана. Теперь сверю реализацию.",
      calls: [{ id: "inspect-worker", name: "worker", arguments: { operation: "status" } }],
    };
  }
  commentary.resolve();
  return {
    text:
      typeof latest === "string" && latest.includes("Worker status: done")
        ? "<summary><h2>Проверка завершена</h2><p>Команда выполнена успешно. API сохранён.</p></summary>"
        : "Прогоняем E2E тесты. **Можем общаться во время работы.**",
  };
}
