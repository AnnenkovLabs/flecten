const { mkdirSync, rmSync, writeFileSync } = require("node:fs");
const path = require("node:path");

function signingState(platform) {
  const missing = [];
  const certificate =
    platform === "win32" ? process.env.WIN_CSC_LINK || process.env.CSC_LINK : process.env.CSC_LINK;
  if (!certificate) {
    missing.push(platform === "win32" ? "CSC_LINK or WIN_CSC_LINK" : "CSC_LINK");
  }
  let notarized = true;
  if (platform === "darwin") {
    if (!process.env.APPLE_ID) missing.push("APPLE_ID");
    if (!process.env.APPLE_APP_SPECIFIC_PASSWORD) missing.push("APPLE_APP_SPECIFIC_PASSWORD");
    if (!process.env.APPLE_TEAM_ID) missing.push("APPLE_TEAM_ID");
    notarized = !missing.some((name) => name.startsWith("APPLE_"));
  }
  return { certificate: Boolean(certificate), missing, notarized };
}

function recordSigningStatus(context) {
  const platform = context.electronPlatformName;
  if (platform !== "darwin" && platform !== "win32") return;
  const name = platform === "darwin" ? "macos" : "windows";
  const markerPath = path.join(context.outDir, `UNSIGNED-${name}.txt`);
  const state = signingState(platform);
  if (!state.certificate && process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") {
    console.log(
      `[signing] ${name}: no certificate in CI secrets, leaving discovery to electron-builder`,
    );
    return;
  }
  if (state.missing.length === 0) {
    rmSync(markerPath, { force: true });
    console.log(`[signing] ${name}: certificates and notarization credentials are configured`);
    return;
  }
  const version = context.packager?.appInfo?.version ?? "unknown";
  const lines = [
    `Flecten ${version} for ${name} is UNSIGNED.`,
    `Missing CI secrets: ${state.missing.join(", ")}.`,
    `Code signing certificate: ${state.certificate ? "configured" : "absent"}.`,
    ...(platform === "darwin"
      ? [`Notarization credentials: ${state.notarized ? "configured" : "absent"}.`]
      : []),
    platform === "darwin"
      ? "Squirrel.Mac rejects updates from a build without a Developer ID signature."
      : "Windows SmartScreen warns about installers without an Authenticode signature.",
  ];
  mkdirSync(context.outDir, { recursive: true });
  writeFileSync(markerPath, `${lines.join("\n")}\n`);
  console.log(`[signing] UNSIGNED ${name}: missing ${state.missing.join(", ")}`);
}

exports.afterPack = async function afterPack(context) {
  recordSigningStatus(context);
};

exports.default = async function notarizeApp(context) {
  if (process.platform !== "darwin") return;
  const appleId = process.env.APPLE_ID;
  const appleIdPassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  if (!appleId || !appleIdPassword || !teamId) {
    console.log(
      "[signing] notarization skipped: APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD or APPLE_TEAM_ID is not set",
    );
    return;
  }

  const { notarize } = require("@electron/notarize");
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  await notarize({ appPath, appleId, appleIdPassword, teamId });
  console.log(`[signing] notarized ${appPath}`);
};
