import { randomBytes } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { accessibility } from "./accessibility.mjs";
import { delay, DesktopError, executable, firstLine, killProcess, runProcess, startProcess, stopProcess } from "./process.mjs";

const REQUIRED = ["Xvfb", "xauth", "xdotool", "import", "dbus-daemon", "python3"];
const BUTTONS = { left: "1", middle: "2", right: "3" };
const WHEELS = { up: "4", down: "5", left: "6", right: "7" };
const KEY_NAMES = new Set([
  "Return", "Enter", "Tab", "Escape", "BackSpace", "Delete", "space", "Space",
  "Left", "Right", "Up", "Down", "Home", "End", "Page_Up", "Page_Down", "Insert",
  "Control", "Ctrl", "Alt", "Shift", "Super", "Meta", "Print", "Menu",
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`),
]);
const KEY_ALIASES = { Enter: "Return", Space: "space", Ctrl: "Control", Meta: "Super" };
function integer(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max)
    throw new DesktopError("INVALID_ACTION", `${label} must be an integer between ${min} and ${max}.`);
  return value;
}
function safeKeys(keys) {
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 6)
    throw new DesktopError("INVALID_ACTION", "Use between one and six keys.");
  return keys.map((key) => {
    if (typeof key !== "string" || !(KEY_NAMES.has(key) || (key.length === 1 && key.codePointAt(0) >= 33 && key.codePointAt(0) <= 126 && key !== "+")))
      throw new DesktopError("INVALID_ACTION", "Use named keys or a single printable ASCII character.");
    return KEY_ALIASES[key] ?? key;
  }).join("+");
}

export class DesktopBackend {
  #directory;
  #env;
  #services = [];
  #browser;
  #clipboard;
  #stopping;
  #ready = false;
  #width = 1280;
  #height = 800;
  #accessibility = "unknown";

  status() {
    const missingDependencies = REQUIRED.filter((name) => !executable(name));
    return {
      supported: process.platform === "linux", ready: this.#ready,
      backend: "x11-private", width: this.#width, height: this.#height,
      missingDependencies,
      applications: executable("firefox") ? ["firefox"] : [],
      capabilities: { screenshot: true, pointer: true, keyboard: true, accessibility: this.#accessibility },
      isolation: { desktop: "private", filesystem: "shared-account", network: "host" },
    };
  }

  async start({ width = 1280, height = 800 } = {}, signal) {
    signal?.throwIfAborted();
    if (this.#ready) return this.status();
    if (this.#directory) throw new DesktopError("NOT_READY", "Desktop is already starting or stopping.");
    if (process.platform !== "linux") throw new DesktopError("UNSUPPORTED_PLATFORM", "The private desktop currently requires Linux.");
    const missing = this.status().missingDependencies;
    if (missing.length) throw new DesktopError("DEPENDENCY_MISSING", `Install desktop programs: ${missing.join(", ")}.`);
    try {
      await runProcess("python3", ["-c", 'import gi; gi.require_version("Gtk", "3.0"); gi.require_version("Gdk", "3.0"); from gi.repository import Gtk, Gdk'], { env: { PATH: process.env.PATH ?? "/usr/bin:/bin" }, signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new DesktopError("DEPENDENCY_MISSING", "Install GTK 3 PyGObject for Python 3 before starting the desktop. It is required for reliable UTF-8 typing.");
    }
    this.#width = integer(width, 640, 1920, "Width");
    this.#height = integer(height, 480, 1200, "Height");
    this.#directory = await mkdtemp(join(tmpdir(), "flecten-computer-"));
    try {
      for (const name of ["home", "runtime", "config", "cache", "data", "profile", "services"])
        await mkdir(join(this.#directory, name), { mode: 0o700 });
      await writeFile(join(this.#directory, "profile", "user.js"), [
        'user_pref("browser.shell.checkDefaultBrowser", false);',
        'user_pref("browser.startup.homepage_override.mstone", "ignore");',
        'user_pref("browser.aboutwelcome.enabled", false);',
        'user_pref("datareporting.policy.firstRunURL", "");',
        'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);',
        'user_pref("accessibility.force_disabled", -1);',
      ].join("\n"));
      const authority = join(this.#directory, "Xauthority");
      await writeFile(authority, "", { mode: 0o600 });
      await chmod(this.#directory, 0o700);
      const cookie = randomBytes(16).toString("hex");
      const env = {
        PATH: process.env.PATH ?? "/usr/bin:/bin", LANG: process.env.LANG ?? "C.UTF-8",
        HOME: join(this.#directory, "home"), XAUTHORITY: authority,
        XDG_RUNTIME_DIR: join(this.#directory, "runtime"), XDG_CONFIG_HOME: join(this.#directory, "config"),
        XDG_CACHE_HOME: join(this.#directory, "cache"), XDG_DATA_HOME: join(this.#directory, "data"),
        TMPDIR: this.#directory, GDK_BACKEND: "x11", QT_QPA_PLATFORM: "xcb",
        XDG_SESSION_TYPE: "x11", XDG_CURRENT_DESKTOP: "Flecten", MOZ_ENABLE_WAYLAND: "0",
        MOZ_DBUS_REMOTE: "0", MOZ_CRASHREPORTER_DISABLE: "1", NO_AT_BRIDGE: "0",
        MOZ_ACCESSIBILITY_ATSPI_ENABLED: "1", QT_LINUX_ACCESSIBILITY_ALWAYS_ON: "1",
        GTK_USE_PORTAL: "0",
        ATSPI_DBUS_IMPLEMENTATION: "dbus-daemon",
        FLECTEN_DESKTOP_WIDTH: String(width), FLECTEN_DESKTOP_HEIGHT: String(height),
      };
      await runProcess("xauth", ["-f", authority, "source", "-"], { env, input: `add :0 MIT-MAGIC-COOKIE-1 ${cookie}\n`, signal });
      const server = startProcess("Xvfb", ["-displayfd", "3", "-screen", "0", `${width}x${height}x24`, "-auth", authority, "-nolisten", "tcp", "-noreset"], { env, extraPipe: true });
      this.#services.push(server);
      server.stdout.resume(); server.stderr.resume();
      const display = Number(await firstLine(server, server.stdio[3], { signal }));
      if (!Number.isInteger(display) || display < 0 || display > 65535)
        throw new DesktopError("PROCESS_FAILED", "The private display returned an invalid identifier.");
      env.DISPLAY = `:${display}`;
      await runProcess("xauth", ["-f", authority, "source", "-"], { env, input: `add :${display} MIT-MAGIC-COOKIE-1 ${cookie}\n`, signal });
      // Only activate accessibility services. Desktop portals can mount FUSE filesystems and
      // launch unrelated account services even though the display and bus are private.
      try { await copyFile("/usr/share/dbus-1/services/org.a11y.Bus.service", join(this.#directory, "services", "org.a11y.Bus.service")); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const escape = (value) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
      const busConfig = join(this.#directory, "bus.conf");
      await writeFile(busConfig, `<busconfig><type>session</type><listen>unix:tmpdir=${escape(this.#directory)}</listen><auth>EXTERNAL</auth><servicedir>${escape(join(this.#directory, "services"))}</servicedir><policy context="default"><allow send_destination="*"/><allow receive_sender="*"/><allow own="*"/></policy></busconfig>`);
      const bus = startProcess("dbus-daemon", ["--config-file", busConfig, "--nofork", "--nopidfile", "--nosyslog", "--print-address=1"], { env });
      this.#services.push(bus);
      bus.stderr.resume();
      const address = await firstLine(bus, bus.stdout, { signal });
      if (!address.startsWith("unix:")) throw new DesktopError("PROCESS_FAILED", "Private desktop D-Bus returned an invalid address.");
      env.DBUS_SESSION_BUS_ADDRESS = address;
      bus.stdout.resume();
      this.#env = env;
      await runProcess("xdotool", ["getdisplaygeometry"], { env, signal });
      signal?.throwIfAborted();
      this.#ready = true;
      for (const service of this.#services)
        service.once("exit", () => { if (this.#ready) this.#ready = false; });
      return this.status();
    } catch (error) {
      await this.stop();
      throw error;
    }
  }

  #requireReady() {
    if (!this.#ready || !this.#env) throw new DesktopError("NOT_READY", "Start the private desktop first.");
    return this.#env;
  }
  #point(x, y) {
    integer(x, 0, this.#width - 1, "X coordinate");
    integer(y, 0, this.#height - 1, "Y coordinate");
    return [String(x), String(y)];
  }
  async #input(args, signal, input) {
    try {
      return await runProcess("xdotool", args, { env: this.#requireReady(), signal, input, mutating: true, timeoutMs: 10000 });
    } catch (error) {
      if (this.#ready) await runProcess("xdotool", ["keyup", "Control_L", "Control_R", "Shift_L", "Shift_R", "Alt_L", "Alt_R", "Super_L", "Super_R", "mouseup", "1", "mouseup", "2", "mouseup", "3"], { env: this.#env, timeoutMs: 1000 }).catch(() => {});
      throw error;
    }
  }

  async #type(text, signal) {
    if (!executable("python3")) throw new DesktopError("DEPENDENCY_MISSING", "Install Python 3 and GTK 3 PyGObject for reliable UTF-8 text input.");
    if (this.#clipboard) await stopProcess(this.#clipboard);
    const clipboard = startProcess("python3", [fileURLToPath(new URL("./clipboard.py", import.meta.url))], { env: this.#requireReady(), input: text });
    this.#clipboard = clipboard;
    clipboard.stderr.resume();
    try {
      if (await firstLine(clipboard, clipboard.stdout, { signal }) !== "READY")
        throw new DesktopError("PROCESS_FAILED", "The private clipboard could not prepare text input.");
      // Start listening before sending the shortcut, so a fast clipboard request cannot be lost.
      const delivered = firstLine(clipboard, clipboard.stdout, { signal, timeoutMs: 5000 });
      delivered.catch(() => {});
      // ponytail: Ctrl+V targets the current Firefox workspace; add per-app paste APIs when launch supports other applications.
      await this.#input(["key", "--clearmodifiers", "Control+v"], signal);
      if (await delivered !== "DELIVERED")
        throw new DesktopError("PROCESS_FAILED", "Text input was not acknowledged. Observe before retrying.", "uncertain");
      clipboard.stdout.resume();
    } catch (error) { await stopProcess(clipboard); this.#clipboard = undefined; error.delivery = "uncertain"; throw error; }
  }

  async observe(signal) {
    const env = this.#requireReady();
    const tree = await accessibility(env, signal);
    this.#accessibility = tree.available ? "available" : "unavailable";
    const image = await runProcess("import", ["-limit", "memory", "64MiB", "-limit", "map", "128MiB", "-window", "root", "-depth", "8", "png:-"], { env, signal });
    if (image.length < 24 || image.toString("hex", 0, 8) !== "89504e470d0a1a0a" || image.readUInt32BE(16) !== this.#width || image.readUInt32BE(20) !== this.#height)
      throw new DesktopError("PROCESS_FAILED", "Desktop capture did not match the private display dimensions.");
    return {
      width: this.#width, height: this.#height, capturedAt: new Date().toISOString(),
      image: { mimeType: "image/png", data: image.toString("base64") },
      accessibility: tree,
    };
  }

  async act(action, signal) {
    this.#requireReady();
    signal?.throwIfAborted();
    switch (action.type) {
      case "click": {
        const point = this.#point(action.x, action.y);
        const button = BUTTONS[action.button ?? "left"];
        if (!button) throw new DesktopError("INVALID_ACTION", "Choose left, middle or right mouse button.");
        const count = integer(action.clickCount ?? 1, 1, 2, "Click count");
        await this.#input(["mousemove", "--sync", ...point, "click", "--clearmodifiers", "--repeat", String(count), "--delay", "80", button], signal);
        break;
      }
      case "move":
        await this.#input(["mousemove", "--sync", ...this.#point(action.x, action.y)], signal); break;
      case "type":
        if (typeof action.text !== "string" || action.text.length > 16000 || action.text.includes("\0"))
          throw new DesktopError("INVALID_ACTION", "Text must be at most 16000 characters without NUL.");
        await this.#type(action.text, signal); break;
      case "key":
        await this.#input(["key", "--clearmodifiers", safeKeys(action.keys)], signal); break;
      case "scroll": {
        const direction = WHEELS[action.direction];
        if (!direction) throw new DesktopError("INVALID_ACTION", "Choose a supported scroll direction.");
        await this.#input(["mousemove", "--sync", ...this.#point(action.x, action.y), "click", "--clearmodifiers", "--repeat", String(integer(action.amount ?? 3, 1, 20, "Scroll amount")), "--delay", "30", direction], signal); break;
      }
      case "drag": {
        const from = this.#point(action.fromX, action.fromY);
        const to = this.#point(action.toX, action.toY);
        try {
          await this.#input(["mousemove", "--sync", ...from, "mousedown", "1", "sleep", "0.1", "mousemove", "--sync", ...to, "sleep", "0.1", "mouseup", "1"], signal);
        } finally {
          // Cancellation can interrupt between mousedown and mouseup; always release on the private display.
          if (this.#ready) await runProcess("xdotool", ["mouseup", "1"], { env: this.#env, timeoutMs: 1000 }).catch(() => {});
        }
        break;
      }
      case "wait":
        await delay(integer(action.durationMs, 0, 2000, "Wait duration"), signal); break;
      default: throw new DesktopError("INVALID_ACTION", "Unsupported desktop action.");
    }
    return { type: action.type, delivery: "delivered-unverified", completedAt: new Date().toISOString() };
  }

  async launch({ url }, signal) {
    const env = this.#requireReady();
    let parsed;
    try { parsed = new URL(url); } catch { throw new DesktopError("INVALID_ACTION", "Enter a valid HTTP or HTTPS URL."); }
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password)
      throw new DesktopError("INVALID_ACTION", "Use an HTTP or HTTPS URL without embedded credentials.");
    if (!executable("firefox")) throw new DesktopError("DEPENDENCY_MISSING", "Install Firefox to open a page in the private desktop.");
    try {
      if (this.#browser && this.#browser.exitCode === null && this.#browser.signalCode === null) {
        await this.act({ type: "key", keys: ["Control", "l"] }, signal);
        await this.act({ type: "type", text: parsed.href }, signal);
        await accessibility(env, signal);
        await this.act({ type: "key", keys: ["Return"] }, signal);
      } else {
        const browser = startProcess("firefox", ["--no-remote", "--new-instance", "--profile", join(this.#directory, "profile"), "--new-window", parsed.href], { env });
        this.#browser = browser;
        this.#services.push(browser);
        browser.stdout.resume(); browser.stderr.resume();
        const abort = () => killProcess(browser);
        signal?.addEventListener("abort", abort, { once: true });
        try {
          const windows = await runProcess("xdotool", ["search", "--sync", "--onlyvisible", "--class", "firefox"], { env, signal, timeoutMs: 15000, maxBytes: 8192 });
          const window = windows.toString("utf8").trim().split("\n")[0];
          if (!window || !Number.isSafeInteger(Number(window))) throw new DesktopError("PROCESS_FAILED", "Firefox did not create a usable private window.");
          await runProcess("xdotool", ["windowsize", "--sync", window, String(this.#width), String(this.#height), "windowmove", "--sync", window, "0", "0", "windowfocus", "--sync", window], { env, signal });
        } catch (error) { killProcess(browser); this.#browser = undefined; throw error; }
        finally { signal?.removeEventListener("abort", abort); }
      }
      return { application: "firefox", url: parsed.href, delivery: "delivered-unverified" };
    } catch (error) { error.delivery = "uncertain"; throw error; }
  }

  stop() {
    if (this.#stopping) return this.#stopping;
    this.#ready = false;
    // Dispatch every kill before yielding, including clipboard ownership and escaped descendants.
    const pending = [this.#clipboard, ...this.#services].map(stopProcess);
    this.#clipboard = undefined;
    this.#services = [];
    this.#browser = undefined;
    const directory = this.#directory;
    this.#stopping = (async () => {
      try {
        await Promise.all(pending);
        if (directory) await rm(directory, { recursive: true, force: true });
      } finally {
        this.#directory = undefined; this.#env = undefined; this.#stopping = undefined;
      }
    })();
    return this.#stopping;
  }
}
