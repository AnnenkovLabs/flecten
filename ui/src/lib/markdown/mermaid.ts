import { sanitizeSvg } from "./sanitize";
import { HARNESS_TOKENS } from "./tokens";

const token = (name: keyof typeof HARNESS_TOKENS): string => HARNESS_TOKENS[name];

export const MERMAID_THEME = {
  fontFamily: token("--font"),
  themeVariables: {
    background: token("--bg"),
    primaryColor: token("--raised"),
    primaryTextColor: token("--text"),
    primaryBorderColor: token("--line-strong"),
    secondaryColor: token("--raised"),
    tertiaryColor: token("--surface"),
    textColor: token("--text"),
    mainBkg: token("--surface"),
    nodeBorder: token("--line-strong"),
    clusterBkg: token("--surface"),
    clusterBorder: token("--line"),
    edgeLabelBackground: token("--surface"),
    lineColor: token("--text-2"),
    actorBkg: token("--raised"),
    actorBorder: token("--text-2"),
    actorTextColor: token("--text"),
    signalColor: token("--text-2"),
    signalTextColor: token("--text"),
    labelBoxBkgColor: token("--raised"),
    labelBoxBorderColor: token("--line-strong"),
    labelTextColor: token("--text"),
    loopTextColor: token("--text"),
    noteBkgColor: token("--raised"),
    noteBorderColor: token("--line-strong"),
    noteTextColor: token("--text"),
    activationBkgColor: token("--raised"),
    activationBorderColor: token("--text-2"),
  },
};

type MermaidRenderer = typeof import("mermaid").default;

let pipeline: Promise<MermaidRenderer> | null = null;

/**
 * Labels are plain SVG text: HTML labels live in foreignObject, which sanitizeSvg removes, and
 * the diagram would come out as empty boxes.
 */
export const MERMAID_CONFIG = {
  startOnLoad: false,
  securityLevel: "strict",
  theme: "base",
  htmlLabels: false,
  fontFamily: MERMAID_THEME.fontFamily,
  themeVariables: MERMAID_THEME.themeVariables,
} as const;

function loadRenderer(): Promise<MermaidRenderer> {
  pipeline ??= import("mermaid").then(({ default: mermaid }) => {
    mermaid.initialize(MERMAID_CONFIG);
    return mermaid;
  });
  return pipeline;
}

export async function renderMermaid(source: string, id: string): Promise<string | null> {
  const mermaid = await loadRenderer();
  const { svg } = await mermaid.render(id, source);
  return sanitizeSvg(svg);
}
