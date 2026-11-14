export {};

/** Native fixture ignores sandbox argv so runSandboxed can exercise real inherited pipes. */
if (process.argv.includes("--fixture-child")) {
  setTimeout(() => {}, 30_000);
} else {
  await Bun.write(Bun.stdout, "x".repeat(3_000_000));
  await Bun.write(Bun.stderr, "tail");
  Bun.spawn([process.execPath, "--fixture-child"], {
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(0);
}
