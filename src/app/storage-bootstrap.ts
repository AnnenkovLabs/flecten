import { realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { productEnv } from "../../shared/environment.cjs";
import { readProjectIndex } from "../../shared/project-index.cjs";
import type { StorageMigrationState } from "../../shared/storage-migration";
import {
  acceptStorageMigration,
  inspectStorageMigration,
  interruptedStorageMigration,
  migrateStorageRoots,
} from "../store/storage-migration";
import { redact } from "../util/redact";

export const STORAGE_COMMANDS = ["storage.migrate", "storage.accept", "storage.status"] as const;
export type StorageCommandType = (typeof STORAGE_COMMANDS)[number];

/** Unavailable remembered projects wait until opening; explicitly selected roots stay strict. */
export async function storageRoots(cwd: string): Promise<string[]> {
  const roots = new Set([await realpath(cwd)]);
  if (productEnv("CONFIG")?.trim()) return [...roots];
  const profile = productEnv("PROFILE")?.trim();
  if (profile) {
    roots.add(profile);
    roots.add(join(profile, "projectless"));
    for (const project of readProjectIndex(profile).projects) {
      try {
        if ((await stat(project.path)).isDirectory()) roots.add(await realpath(project.path));
      } catch (error) {
        // Optional remembered folders can be offline or inaccessible; selected roots stay strict.
        if (
          !["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(
            (error as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw error;
      }
    }
  } else roots.add(homedir());
  const canonical = await Promise.all(
    [...roots].map(async (root) => {
      try {
        return await realpath(root);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return resolve(root);
        throw error;
      }
    }),
  );
  return [...new Set(canonical)];
}

/** Keeps the core unopened until verified storage has been explicitly accepted. */
export class StorageBootstrap {
  #state: StorageMigrationState | null = null;
  #roots: string[] = [];
  #running: Promise<void> | null = null;
  #release!: () => void;
  readonly ready = new Promise<void>((resolve) => {
    this.#release = resolve;
  });
  #accepted = false;

  constructor(
    private cwd: string,
    private emit: (event: unknown) => void,
  ) {}

  #publish(patch: Partial<StorageMigrationState>): void {
    this.#state = {
      version: 1,
      phase: "required",
      step: "inspect",
      completed: 0,
      total: this.#roots.length,
      paths: this.#roots,
      backups: [],
      ...this.#state,
      ...patch,
    };
    this.emit({ type: "storage.migration", migration: this.#state });
  }

  #failed(error: unknown): void {
    this.#publish({
      phase: "failed",
      error: redact(error instanceof Error ? error.message : String(error)),
    });
  }

  async initialize(): Promise<void> {
    try {
      this.#roots = await storageRoots(this.cwd);
      const result = await inspectStorageMigration(this.#roots);
      if (!result.required) {
        this.#accepted = true;
        this.#release();
        return;
      }
      this.#publish({ phase: "required" });
      if (await interruptedStorageMigration(this.#roots)) await this.command("storage.migrate");
    } catch (error) {
      this.#failed(error);
    }
  }

  get blocked(): boolean {
    return !this.#accepted;
  }

  async command(type: string): Promise<Record<string, unknown>> {
    if (type === "storage.status" || type === "hello" || type === "status") {
      if (this.#state && !this.#accepted)
        this.emit({ type: "storage.migration", migration: this.#state });
      return { migration: this.#accepted ? null : this.#state };
    }
    if (type === "storage.migrate") {
      if (this.#accepted || this.#running || this.#state?.phase === "complete") return {};
      this.#publish({ phase: "running", step: "inspect", completed: 0, error: undefined });
      this.#running = this.#migrate()
        .catch((error) => this.#failed(error))
        .finally(() => {
          this.#running = null;
        });
      return {};
    }
    if (type !== "storage.accept")
      throw new Error("Complete storage migration before opening the core.");
    if (this.#accepted) return {};
    if (this.#state?.phase !== "complete") throw new Error("Storage migration has not completed.");
    try {
      await acceptStorageMigration(this.#roots);
      this.#accepted = true;
      this.#release();
      return {};
    } catch (error) {
      this.#failed(error);
      throw error;
    }
  }

  async #migrate(): Promise<void> {
    this.#roots = await storageRoots(this.cwd);
    await migrateStorageRoots(this.#roots, (step, currentPath, backups) => {
      this.#publish({
        phase: "running",
        step,
        currentPath,
        paths: this.#roots,
        total: this.#roots.length,
        completed: this.#roots.indexOf(currentPath),
        backups: [...backups],
      });
    });
    this.#publish({ phase: "complete", completed: this.#roots.length, currentPath: undefined });
  }
}
