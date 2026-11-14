export {};

await Bun.write(Bun.stdout, "x".repeat(4_000_000));
await Bun.write(
  Bun.stdout,
  "\nTOKEN=arbitrary-secret-value\nopaque credential across words\nTAIL-привіт\n",
);
