import {
  type CriterionReport,
  type WorkerAcceptance,
  WorkerAcceptanceSchema,
  type WorkerAssignment,
} from "../../shared/worker-assignment";
import type { Event, RunResult, SessionEvent, ToolResult } from "../core/types";

type Evidence = {
  callId: string;
  rawCallId?: string;
  tool: string;
  result: ToolResult;
  revision?: number;
};

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
        if (this.state?.taskId !== event.acceptance.taskId) this.#results.clear();
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
    const latestQuote = this.#userSources.at(-1);
    const normalized = assignment ?? {
      objective: task ?? "",
      userConstraints: latestQuote ? [latestQuote] : [],
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
      event.call.name === "criterion" ||
      event.call.name === "ask_talker"
    )
      return;
    const record = {
      callId: shown.call.id,
      rawCallId: event.call.id,
      tool: event.call.name,
      result: event.result,
      revision: this.state.revision,
    };
    this.#results.set(event.call.id, record);
    if (shown.call.id !== event.call.id) this.#results.set(shown.call.id, record);
    // ponytail: the last 2,048 results per task; use the durable tool log for earlier evidence on multi-hour tasks.
    if (this.#results.size > 2_048)
      this.#results.delete(this.#results.keys().next().value as string);
  }

  report(report: CriterionReport | readonly CriterionReport[]): WorkerAcceptance {
    if (Array.isArray(report)) {
      if (report.length === 0) throw new Error("Provide at least one criterion report");
      let last: WorkerAcceptance | undefined;
      for (const item of report) {
        last = this.#reportSingle(item);
      }
      if (!last) throw new Error("No criterion reports applied");
      return last;
    }
    return this.#reportSingle(report as CriterionReport);
  }

  #findToolEvidence(callId: string): Evidence | undefined {
    const currentRevision = this.state?.revision ?? 0;
    const direct = this.#results.get(callId);
    if (direct?.result.ok) {
      if ((direct.revision ?? currentRevision) === currentRevision) return direct;
      let latestSameTool: Evidence | undefined;
      for (const entry of this.#results.values()) {
        if (
          entry.result.ok &&
          (entry.revision ?? currentRevision) === currentRevision &&
          entry.tool === direct.tool
        ) {
          latestSameTool = entry;
        }
      }
      if (latestSameTool) return latestSameTool;
      let hasCurrentRevisionEvidence = false;
      for (const entry of this.#results.values()) {
        if (entry.result.ok && (entry.revision ?? currentRevision) === currentRevision) {
          hasCurrentRevisionEvidence = true;
          break;
        }
      }
      return hasCurrentRevisionEvidence ? direct : undefined;
    }
    if (callId === "latest" || callId === "last") {
      let latestOk: Evidence | undefined;
      for (const entry of this.#results.values()) {
        if (entry.result.ok && (entry.revision ?? currentRevision) === currentRevision) {
          latestOk = entry;
        }
      }
      if (latestOk) return latestOk;
      let hasCurrentRevisionEvidence = false;
      for (const entry of this.#results.values()) {
        if (entry.result.ok && (entry.revision ?? currentRevision) === currentRevision) {
          hasCurrentRevisionEvidence = true;
          break;
        }
      }
      if (hasCurrentRevisionEvidence) {
        for (const entry of this.#results.values()) {
          if (entry.result.ok) latestOk = entry;
        }
      }
      return latestOk;
    }
    let byTool: Evidence | undefined;
    for (const entry of this.#results.values()) {
      if (
        entry.result.ok &&
        (entry.revision ?? currentRevision) === currentRevision &&
        entry.tool === callId
      ) {
        byTool = entry;
      }
    }
    if (byTool) return byTool;
    let hasCurrentRevisionEvidence = false;
    for (const entry of this.#results.values()) {
      if (entry.result.ok && (entry.revision ?? currentRevision) === currentRevision) {
        hasCurrentRevisionEvidence = true;
        break;
      }
    }
    if (hasCurrentRevisionEvidence) {
      for (const entry of this.#results.values()) {
        if (entry.result.ok && entry.tool === callId) byTool = entry;
      }
    }
    return byTool;
  }

  #reportSingle(report: CriterionReport): WorkerAcceptance {
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
      const actual = this.#findToolEvidence(report.evidence.callId);
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
    if (["done", "end"].includes(result.stopReason) && result.summary.trim()) {
      const statement = result.summary.slice(0, 8000);
      const latestTool = this.#findToolEvidence("latest");
      for (const criterion of this.state.criteria) {
        if (criterion.status !== "open") continue;
        const definition = this.state.assignment.acceptanceCriteria.find(
          ({ id }) => id === criterion.id,
        );
        if (!definition) continue;
        if (definition.evidenceRequirement === "model_assertion") {
          Object.assign(criterion, {
            status: "met",
            evidence: { kind: "model_assertion", statement },
          });
        } else if (definition.evidenceRequirement === "tool_result" && latestTool?.result.ok) {
          Object.assign(criterion, {
            status: "met",
            evidence: {
              kind: "tool_result",
              statement,
              callId: latestTool.callId,
              tool: latestTool.tool,
              output: latestTool.result.output.slice(0, 2000),
            },
          });
        }
      }
    }
    this.phase("reviewing");
  }

  phase(phase: WorkerAcceptance["phase"]): void {
    if (!this.state) return;
    this.state = { ...this.state, phase };
    this.save();
  }

  unmet(): boolean {
    if (!this.state) return false;
    const latestTool = this.#findToolEvidence("latest");
    return this.state.criteria.some((criterion) => {
      if (criterion.status === "met") return false;
      if (criterion.status === "blocked") return true;
      const definition = this.state?.assignment.acceptanceCriteria.find(
        ({ id }) => id === criterion.id,
      );
      if (definition?.evidenceRequirement === "tool_result") return !latestTool?.result.ok;
      return false;
    });
  }

  hasOpenCriteria(): boolean {
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
    const recentTools: string[] = [];
    const seenRaw = new Set<string>();
    for (const entry of [...this.#results.values()].reverse()) {
      if (!entry.result.ok) continue;
      const key = entry.rawCallId ?? entry.callId;
      if (seenRaw.has(key)) continue;
      seenRaw.add(key);
      recentTools.push(`${entry.tool} (callId: ${key})`);
      if (recentTools.length >= 6) break;
    }
    const hint =
      recentTools.length > 0 && this.unmet()
        ? `\n\nAvailable successful tool call IDs for tool_result criteria: ${recentTools.join(", ")}`
        : "";
    const markdown =
      this.state.criteria
        .map((criterion) => {
          const definition = this.state?.assignment.acceptanceCriteria.find(
            ({ id }) => id === criterion.id,
          );
          return `- ${criterion.id}: ${criterion.status}. ${definition?.description}\n  ${criterion.evidence ? `Evidence (${criterion.evidence.kind}): ${criterion.evidence.statement}` : (criterion.reason ?? "Evidence pending.")}`;
        })
        .join("\n") + hint;
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
      "# User constraints",
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
      "Satisfy every acceptance criterion with actual tool execution or verification before completion; use the criterion tool if you need to report explicit evidence or a blocker.",
    ].join("\n\n");
  }

  private save(): void {
    if (this.state) this.emit(WorkerAcceptanceSchema.parse(this.state));
  }
}
