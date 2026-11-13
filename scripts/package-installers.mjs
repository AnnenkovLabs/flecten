// Empty CI secrets must remain absent: electron-builder treats CSC_LINK="" as the project path.
const env = { ...process.env };
for (const key of [
  "CSC_LINK",
  "WIN_CSC_LINK",
  "CSC_KEY_PASSWORD",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
]) {
  if (env[key] === "") delete env[key];
}
const child = Bun.spawn(["bunx", "electron-builder", ...process.argv.slice(2)], {
  env,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
process.exitCode = await child.exited;
