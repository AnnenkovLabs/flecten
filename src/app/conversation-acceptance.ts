import {
  type CriterionReport,
  type WorkerAcceptance,
  WorkerAcceptanceSchema,
  type WorkerAssignment,
} from "../../shared/worker-assignment";
import type { Event, RunResult, SessionEvent, ToolResult } from "../core/types";

type Evidence = { callId: string; tool: string; result: ToolResult };

/** The journal owns task truth; prose and a Worker's final summary cannot mark explicit criteria met. */
export class ConversationAcceptance {
  state: WorkerAcceptance | undefined;
  readonly #results = new Map<string, Evidence>();
  #userSources: string[] = [];

  constructor(private readonly emit: (state: WorkerAcceptance) => void) {}

  restore(events: readonly Event[]): void {
    for (const event of events) {
      if (event.type === "session.started" && !event.internal) this.human(event.prompt);
      if (event.type === "steer.applied") this.human(event.text);
      if (event.type === "worker.acceptance") {
        if (
          this.state?.taskId !== event.acceptance.taskId ||
          this.state?.revision !== event.acceptance.revision
        )
          this.#results.clear();
        this.state = WorkerAcceptanceSchema.parse(event.acceptance);
      } else if (event.type === "worker.event") this.note(event.event);
    }
    if (this.state && ["running", "reviewing"].includes(this.state.phase)) {
      this.state = { ...this.state, phase: "unconfirmed" };
    }
  }

  human(text: string): void {
    if (this.#userSources.at(-1) === text) return;
    this.#userSources = [...this.#userSources.slice(-63), text];
  }

  begin(task: string | undefined, assignment?: WorkerAssignment): string {
    if (
      assignment?.userConstraints.some(
        (constraint) => !this.#userSources.some((source) => source.includes(constraint)),
      )
    )
      throw new Error(
        "User constraints must quote an original human message verbatim; put inferred requirements in the objective or criteria.",
      );
    const normalized = assignment ?? {
      objective: task ?? "",
      userConstraints: [],
      expectedOutputs: ["The requested result, preserving the original task."],
      acceptanceCriteria: [
        {
          id: "result",
          description:
            "Fulfil the original task and report results, verification and remaining work.",
          evidenceRequirement: "model_assertion" as const,
        },
      ],
    };
    this.#results.clear();
    this.state = WorkerAcceptanceSchema.parse({
      taskId: crypto.randomUUID(),
      assignment: normalized,
      legacy: assignment === undefined,
      phase: "running",
      directions: [],
      criteria: normalized.acceptanceCriteria.map(({ id }) => ({ id, status: "open" })),
    });
    this.save();
    return assignment ? this.prompt() : (task ?? normalized.objective);
  }

  note(event: SessionEvent, shown: SessionEvent = event): void {
    if (
      !this.state ||
      event.type !== "tool.finished" ||
      shown.type !== "tool.finished" ||
      event.call.name === "criterion"
    )
      return;
    this.#results.set(event.call.id, {
      callId: shown.call.id,
      tool: event.call.name,
      result: event.result,
    });
    // ponytail: the last 128 results per task; use the durable tool log for earlier evidence on very long tasks.
    if (this.#results.size > 128) this.#results.delete(this.#results.keys().next().value as string);
  }

  report(report: CriterionReport): WorkerAcceptance {
    const state = this.state;
    if (state?.phase !== "running") throw new Error("No running assignment to report against");
    const definition = state.assignment.acceptanceCriteria.find(
      ({ id }) => id === report.criterionId,
    );
    const criterion = state.criteria.find(({ id }) => id === report.criterionId);
    if (!definition || !criterion) throw new Error("Unknown criterion ID; use criterion list");
    if (report.status === "met" && !report.evidence)
      throw new Error("A met criterion needs evidence");
    if (report.status === "blocked" && !report.reason)
      throw new Error("A blocked criterion needs its reason and next necessary action");
    let evidence: WorkerAcceptance["criteria"][number]["evidence"];
    if (report.evidence?.kind === "tool_result") {
      const actual = this.#results.get(report.evidence.callId);
      if (!actual?.result.ok)
        throw new Error("Evidence must reference a successful tool result from this assignment");
      evidence = {
        kind: "tool_result",
        statement: report.evidence.statement,
        callId: actual.callId,
        tool: actual.tool,
        output: actual.result.output.slice(0, 2000),
      };
    } else if (report.evidence) evidence = report.evidence;
    if (
      report.status === "met" &&
      definition.evidenceRequirement === "tool_result" &&
      evidence?.kind !== "tool_result"
    )
      throw new Error(
        "This criterion requires an observed successful tool result, not a model assertion",
      );
    Object.assign(criterion, { status: report.status, evidence, reason: report.reason });
    this.save();
    return structuredClone(state);
  }

  reopen(direction: string): void {
    if (!this.state) return;
    this.#results.clear();
    this.state = {
      ...this.state,
      revision: this.state.revision + 1,
      phase: "running",
      directions: [...this.state.directions.slice(-31), direction.slice(0, 8000)],
      criteria: this.state.criteria.map(({ id }) => ({
        id,
        status: "open",
        reason: "Recheck after the latest direction.",
      })),
    };
    this.save();
  }

  resume(): string {
    if (!this.state || this.state.phase === "accepted")
      throw new Error("No unfinished assignment to resume");
    this.phase("running");
    return `${this.prompt()}\n\n# Additional execution directions\n${this.state.directions.join("\n\n")}\n\n# Previous acceptance state\n${this.markdown()}\n\nInspect actual state before resuming. Work on the open or blocked criteria without claiming they are already met.`;
  }

  reviewing(result: RunResult): void {
    if (!this.state) return;
    if (this.state.legacy && ["done", "end"].includes(result.stopReason) && result.summary.trim()) {
      // Compatibility for old string-only starts: explicitly label the final self-report as a model assertion.
      this.state.criteria = [
        {
          id: "result",
          status: "met",
          evidence: { kind: "model_assertion", statement: result.summary.slice(0, 8000) },
        },
      ];
    }
    this.phase("reviewing");
  }

  phase(phase: WorkerAcceptance["phase"]): void {
    if (!this.state) return;
    this.state = { ...this.state, phase };
    this.save();
  }

  unmet(): boolean {
    return this.state?.criteria.some(({ status }) => status !== "met") ?? false;
  }

  guard(active: boolean): string | undefined {
    if (active)
      return "Worker execution or acceptance review is still running. Continue in ordinary Markdown; final completion is unavailable.";
    if (this.state && this.state.phase !== "accepted")
      return `Completion remains unconfirmed (${this.state.phase}). Report open or blocked criteria in ordinary Markdown and preserve their evidence.\n${this.markdown()}`;
  }

  markdown(): string {
    if (!this.state) return "No assignment.";
    const markdown = this.state.criteria
      .map((criterion) => {
        const definition = this.state?.assignment.acceptanceCriteria.find(
          ({ id }) => id === criterion.id,
        );
        return `- ${criterion.id}: ${criterion.status}. ${definition?.description}\n  ${criterion.evidence ? `Evidence (${criterion.evidence.kind}): ${criterion.evidence.statement}` : (criterion.reason ?? "Evidence pending.")}`;
      })
      .join("\n");
    return markdown.length <= 8000
      ? markdown
      : `${markdown.slice(0, 7800)}\nFurther criteria remain available through Worker status or criterion list.`;
  }

  private prompt(): string {
    const assignment = this.state?.assignment;
    if (!assignment) throw new Error("Assignment is not initialized");
    return [
      "# Objective",
      assignment.objective,
      "# User constraints (verbatim)",
      ...assignment.userConstraints.map((line) => `- ${line}`),
      "# Expected outputs",
      ...assignment.expectedOutputs.map((line) => `- ${line}`),
      ...(assignment.currentStep ? ["# Current step", assignment.currentStep] : []),
      ...(assignment.questions?.length ? ["# Questions to answer", ...assignment.questions] : []),
      ...(assignment.sourceScope?.length ? ["# Source scope", ...assignment.sourceScope] : []),
      ...(assignment.sufficiency?.length ? ["# Sufficient result", ...assignment.sufficiency] : []),
      "# Acceptance criteria",
      ...assignment.acceptanceCriteria.map(
        (criterion) =>
          `- ${criterion.id}: ${criterion.description}\n  Required evidence: ${criterion.evidenceRequirement}`,
      ),
      "Report every criterion with the criterion tool before completion. Tool evidence must reference an actual successful call ID; model assertions are explicitly labeled and cannot replace required tool results.",
    ].join("\n\n");
  }

  private save(): void {
    if (this.state) this.emit(WorkerAcceptanceSchema.parse(this.state));
  }
}
