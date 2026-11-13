import { createHash } from "node:crypto";
import { redact, redactKnown } from "../../util/redact";
import type { Message } from "../types";
import type { MemoryCandidate } from "./command";
import type { MemoryEvidence } from "./types";

export function memoryDigest(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function memorySources(messages: readonly Message[], sessionId: string): MemoryEvidence[] {
  return messages.flatMap<MemoryEvidence>((message, index) => {
    if (message.role === "user" && message.memorySource !== undefined) {
      return [
        {
          sessionId,
          role: "user" as const,
          quote: message.memorySource,
          digest: memoryDigest(message.memorySource),
          reference: `user:${index}`,
        },
      ];
    }
    if (message.role === "tool" && message.name !== "memory" && message.name !== "done") {
      return [
        {
          sessionId,
          role: "tool" as const,
          quote: message.content,
          digest: memoryDigest(message.content),
          reference: message.toolCallId,
        },
      ];
    }
    return [];
  });
}

export function safeMemoryText(text: string, secrets: readonly string[]): string {
  return redactKnown(redact(text), secrets);
}

export function validateEvidence(
  candidate: MemoryCandidate,
  sources: readonly MemoryEvidence[],
  system: string,
  secrets: readonly string[],
): MemoryEvidence[] {
  if (
    (candidate.kind === "preference" || candidate.kind === "lesson") &&
    !candidate.evidence.some((source) => source.role === "user")
  ) {
    throw new Error("Preferences and lessons require an exact user correction or preference.");
  }
  if (system.includes(candidate.content)) {
    throw new Error(
      "This evidence is already in project/system instructions. Keep one source of truth.",
    );
  }
  if (safeMemoryText(JSON.stringify(candidate), secrets) !== JSON.stringify(candidate)) {
    throw new Error("Memory contains a credential or secret. Save a non-sensitive lesson instead.");
  }
  return candidate.evidence.map((item) => {
    const source = sources.findLast(
      (source) => source.role === item.role && source.quote.includes(item.quote),
    );
    if (!source)
      throw new Error(
        "Evidence must exactly quote a real source still available in this conversation. Use sources.",
      );
    return { ...source, quote: item.quote };
  });
}
