/** Prerequisites for integration tests that start the real private desktop. */
export function computerEnvironmentProblem(): string | undefined {
  if (process.platform !== "linux") return "private desktop requires Linux";
  const required = ["Xvfb", "xauth", "xdotool", "import", "dbus-daemon", "python3"];
  const missing = required.filter((program) => !Bun.which(program));
  if (missing.length > 0) return `missing desktop programs: ${missing.join(", ")}`;
  const python = Bun.spawnSync([
    "python3",
    "-c",
    'import gi; gi.require_version("Gtk", "3.0"); gi.require_version("Gdk", "3.0"); from gi.repository import Gtk, Gdk',
  ]);
  if (python.exitCode !== 0) return "Python 3 requires GTK 3 PyGObject";
  return undefined;
}
