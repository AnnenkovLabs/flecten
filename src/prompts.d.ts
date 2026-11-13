// Prompt fragments live in prompts/ and are imported as text, so `bun build --compile` embeds them.
declare module "*.md" {
  const text: string;
  export default text;
}

declare module "*.py" {
  const text: string;
  export default text;
}
