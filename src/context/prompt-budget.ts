import { estimateTokens } from "./tokenizer";
import { PROFILE_4, type TokenProfile } from "./types";

export const DEFAULT_PROMPT_BUDGET_TOKENS = 24_000;
const MIN_TRIMMED_PART_CHARS = 160;
const TRIMMED_MARKER_RESERVE = 96;

export interface PromptTextPart {
  readonly text: string;
  /** Only first-party text whose source language is known may bypass translation. */
  readonly workingLanguage?: "en";
}

export interface PromptBudgetPart extends PromptTextPart {
  readonly id: string;
  readonly required?: boolean;
  readonly external?: boolean;
}

export interface PromptBudgetSectionResult {
  readonly id: string;
  readonly tokens: number;
  readonly chars: number;
  readonly required: boolean;
  readonly external: boolean;
  readonly trimmed: boolean;
  readonly omitted: boolean;
}

export interface PromptBudgetResult {
  readonly text: string;
  readonly blocks: readonly PromptTextPart[];
  readonly parts: readonly PromptBudgetSectionResult[];
  readonly tokens: number;
  readonly visibleTokens: number;
  readonly externalTokens: number;
  readonly trimmed: readonly string[];
  readonly omitted: readonly string[];
  readonly overBudget: boolean;
}

export interface PromptBudgetInput {
  readonly parts: readonly PromptBudgetPart[];
  readonly maxTokens?: number;
  readonly profile?: TokenProfile;
}

function omissionMarker(removed: number): string {
  return `\n\n[... ${removed} chars omitted to fit the prompt budget ...]`;
}

function validCap(value: number | undefined): number {
  if (value !== undefined && Number.isFinite(value) && value > 0) return Math.floor(value);
  return DEFAULT_PROMPT_BUDGET_TOKENS;
}

/**
 * Fits the parts into the token cap: required parts stay whole, optional ones are trimmed or
 * omitted in order. Room is shared out in characters, then the text is measured with the token
 * estimator; when code, newlines or non-Latin text make the optional parts denser than the
 * profile, their room shrinks and they are fitted again, so `tokens` stays within the cap
 * whenever an optional part is left to cut.
 */
export function promptBudget(input: PromptBudgetInput): PromptBudgetResult {
  const profile = input.profile ?? PROFILE_4;
  const capTokens = validCap(input.maxTokens);
  let scale = 1;
  let result = fit(input.parts, capTokens, scale, profile);
  const fixed = result.parts
    .filter((part) => part.required)
    .reduce((total, part) => total + part.tokens, 0);
  for (
    let attempt = 0;
    attempt < 4 && result.tokens > capTokens && cuttable(result);
    attempt += 1
  ) {
    const flexible = result.tokens - fixed;
    const room = capTokens - fixed;
    scale *= room > 0 && flexible > 0 ? (room / flexible) * 0.98 : 0;
    result = fit(input.parts, capTokens, scale, profile);
  }
  return result;
}

/** An optional part is still in the text, so a smaller room can cut more. */
function cuttable(result: PromptBudgetResult): boolean {
  return result.parts.some((part) => !part.required && !part.omitted && part.chars > 0);
}

/** One pass: `scale` shrinks the character room of the optional parts. */
function fit(
  parts: readonly PromptBudgetPart[],
  capTokens: number,
  scale: number,
  profile: TokenProfile,
): PromptBudgetResult {
  const capChars = capTokens * profile.charsPerToken;
  const required = parts.filter((part) => part.required === true);
  const optional = parts.filter((part) => part.required !== true);
  const visible: PromptTextPart[] = [];
  const sections: PromptBudgetSectionResult[] = [];
  const trimmed: string[] = [];
  const omitted: string[] = [];
  let visibleChars = 0;
  let externalChars = 0;

  const pushVisible = (text: string, workingLanguage?: "en"): void => {
    visibleChars += text.length + (visible.length > 0 ? 2 : 0);
    visible.push({ text, ...(workingLanguage ? { workingLanguage } : {}) });
  };

  for (const part of required) {
    const text = part.text.trim();
    const external = part.external === true;
    if (external) externalChars += text.length;
    else if (text.length > 0) pushVisible(text, part.workingLanguage);
    sections.push({
      id: part.id,
      tokens: estimateTokens(text, profile).tokens,
      chars: text.length,
      required: true,
      external,
      trimmed: false,
      omitted: false,
    });
  }

  const requiredChars = visibleChars + externalChars;
  const requiredTokens = sections.reduce((total, section) => total + section.tokens, 0);
  const overBudget = requiredChars > capChars || requiredTokens > capTokens;
  let remaining = Math.max(0, Math.floor((capChars - requiredChars) * scale));

  for (const part of optional) {
    const text = part.text.trim();
    if (text.length === 0) {
      sections.push({
        id: part.id,
        tokens: 0,
        chars: 0,
        required: false,
        external: false,
        trimmed: false,
        omitted: false,
      });
      continue;
    }
    const separator = visible.length > 0 ? 2 : 0;
    if (text.length + separator <= remaining) {
      pushVisible(text, part.workingLanguage);
      remaining -= text.length + separator;
      sections.push({
        id: part.id,
        tokens: estimateTokens(text, profile).tokens,
        chars: text.length,
        required: false,
        external: false,
        trimmed: false,
        omitted: false,
      });
      continue;
    }

    const room = remaining - separator - TRIMMED_MARKER_RESERVE;
    if (room >= MIN_TRIMMED_PART_CHARS) {
      const kept = text.slice(0, room);
      const marker = omissionMarker(text.length - kept.length);
      pushVisible(`${kept}${marker}`, part.workingLanguage);
      remaining = Math.max(0, remaining - kept.length - marker.length - separator);
      trimmed.push(part.id);
      sections.push({
        id: part.id,
        tokens: estimateTokens(`${kept}${marker}`, profile).tokens,
        chars: kept.length + marker.length,
        required: false,
        external: false,
        trimmed: true,
        omitted: false,
      });
      continue;
    }

    omitted.push(part.id);
    sections.push({
      id: part.id,
      tokens: 0,
      chars: 0,
      required: false,
      external: false,
      trimmed: false,
      omitted: true,
    });
  }

  if (omitted.length > 0) {
    pushVisible(`<!-- prompt budget omitted: ${omitted.join(", ")} -->`, "en");
  }
  if (overBudget) {
    pushVisible(
      "<!-- prompt budget exceeded: required rules and tool schemas were kept whole -->",
      "en",
    );
  }

  const text = visible.map((part) => part.text).join("\n\n");
  const externalEstimate = parts
    .filter((part) => part.required === true && part.external === true)
    .reduce((total, part) => total + estimateTokens(part.text.trim(), profile).tokens, 0);

  return {
    text,
    blocks: visible,
    parts: sections,
    tokens: estimateTokens(text, profile).tokens + externalEstimate,
    visibleTokens: estimateTokens(text, profile).tokens,
    externalTokens: externalEstimate,
    trimmed,
    omitted,
    overBudget,
  };
}
