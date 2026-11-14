import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lockProject } from "../../src/app/project-lock";
import { ProjectLockedError } from "../../src/errors";

const roots: string[] = [];
const children: Bun.Subprocess[] = [];

async function project(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "liquid-lock-"));
  roots.push(root);
  return root;
}

function lockFile(root: string): string {
  return join(root, ".liquid", "sidecar.lock");
}

/** A live process that is not this one, to stand for another core. */
function otherProcess(): Bun.Subprocess {
  const child = Bun.spawn(["sleep", "30"], { stdout: "ignore", stderr: "ignore" });
  children.push(child);
  return child;
}

async function writeHolder(root: string, pid: number, token = "other"): Promise<void> {
  await mkdir(join(root, ".liquid"), { recursive: true });
  await writeFile(
    lockFile(root),
    JSON.stringify({ pid, token, startedAt: "2026-01-01T00:00:00Z" }),
  );
}

/** Root, or a sandbox with CAP_DAC_OVERRIDE, writes into a read-only folder anyway. */
function permissionsEnforced(): boolean {
  const probe = mkdtempSync(join(tmpdir(), "liquid-probe-"));
  try {
    chmodSync(probe, 0o500);
    mkdirSync(join(probe, "inner"));
    return false;
  } catch {
    return true;
  } finally {
    chmodSync(probe, 0o700);
    rmSync(probe, { recursive: true, force: true });
  }
}

afterEach(async () => {
  for (const child of children.splice(0)) child.kill();
  for (const root of roots.splice(0)) {
    await chmod(root, 0o700).catch(() => undefined);
    await rm(root, { recursive: true, force: true });
  }
});

describe("project lock", () => {
  test("writes this core's pid privately and removes only its own lock", async () => {
    const root = await project();
    const lock = await lockProject(root);
    expect(lock.path).toBe(lockFile(root));
    const holder = JSON.parse(await readFile(lockFile(root), "utf8"));
    expect(holder.pid).toBe(process.pid);
    // POSIX permission bits are not supported by Windows.
    if (process.platform !== "win32") expect((await stat(lockFile(root))).mode & 0o777).toBe(0o600);
    lock.release();
    lock.release();
    expect(await Bun.file(lockFile(root)).exists()).toBe(false);
  });

  test("a live holder keeps the project and the wait ends with its pid", async () => {
    const root = await project();
    const other = otherProcess();
    await writeHolder(root, other.pid);
    const started = Date.now();
    const error = await lockProject(root, 250).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProjectLockedError);
    expect((error as ProjectLockedError).pid).toBe(other.pid);
    expect((error as Error).message).toContain(lockFile(root));
    expect(Date.now() - started).toBeGreaterThanOrEqual(250);
    expect(JSON.parse(await readFile(lockFile(root), "utf8")).pid).toBe(other.pid);
  });

  test("waits while the holder lets go, then takes the project", async () => {
    const root = await project();
    await writeHolder(root, otherProcess().pid);
    setTimeout(() => void rm(lockFile(root)), 200);
    const lock = await lockProject(root, 3_000);
    expect(JSON.parse(await readFile(lockFile(root), "utf8")).pid).toBe(process.pid);
    lock.release();
  });

  test("takes over the lock of a dead core, a broken file and an earlier core with this pid", async () => {
    const root = await project();
    const dead = otherProcess();
    dead.kill();
    await dead.exited;
    for (const write of [
      () => writeHolder(root, dead.pid),
      () => writeFile(lockFile(root), "not json"),
      () => writeHolder(root, process.pid, "earlier"),
    ]) {
      await write();
      const lock = await lockProject(root, 0);
      expect(JSON.parse(await readFile(lockFile(root), "utf8")).pid).toBe(process.pid);
      lock.release();
    }
  });

  test("release leaves a lock that another core holds now", async () => {
    const root = await project();
    const lock = await lockProject(root);
    await writeHolder(root, otherProcess().pid);
    lock.release();
    expect(await Bun.file(lockFile(root)).exists()).toBe(true);
  });

  test.skipIf(!permissionsEnforced())("a read-only project runs unlocked", async () => {
    const root = await project();
    await chmod(root, 0o500);
    const lock = await lockProject(root, 0);
    expect(lock.path).toBeNull();
    lock.release();
  });
});
