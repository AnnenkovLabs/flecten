const UPDATE_CHANNELS = Object.freeze(["stable", "beta"]);

const UPDATE_DEFAULTS = Object.freeze({
  channel: "stable",
  autoCheck: true,
  autoDownload: true,
  installOnQuit: true,
});

function booleanOr(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}

const GITHUB_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

exports.isGithubName = function isGithubName(value) {
  return typeof value === "string" && GITHUB_NAME.test(value);
};

function githubOr(value) {
  if (!value || typeof value !== "object") return undefined;
  if (!exports.isGithubName(value.owner) || !exports.isGithubName(value.repo)) return undefined;
  return Object.freeze({ owner: value.owner, repo: value.repo });
}

/** Shape check for the shell boundary; URL policy lives in shell/update-policy.mjs. */
exports.normalizeUpdateSettings = function normalizeUpdateSettings(value) {
  const source = value && typeof value === "object" ? value : {};
  const channel = UPDATE_CHANNELS.includes(source.channel)
    ? source.channel
    : UPDATE_DEFAULTS.channel;
  const feedUrl =
    typeof source.feedUrl === "string" && source.feedUrl.trim().length > 0
      ? source.feedUrl.trim()
      : undefined;
  const github = githubOr(source.github);
  return Object.freeze({
    channel,
    ...(feedUrl === undefined ? {} : { feedUrl }),
    ...(github === undefined ? {} : { github }),
    autoCheck: booleanOr(source.autoCheck, UPDATE_DEFAULTS.autoCheck),
    autoDownload: booleanOr(source.autoDownload, UPDATE_DEFAULTS.autoDownload),
    installOnQuit: booleanOr(source.installOnQuit, UPDATE_DEFAULTS.installOnQuit),
  });
};

exports.UPDATE_CHANNELS = UPDATE_CHANNELS;
exports.UPDATE_DEFAULTS = UPDATE_DEFAULTS;
