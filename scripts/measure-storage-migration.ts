#!/usr/bin/env bun
import assert from "node:assert/strict";
import { constants } from "node:fs";
import { cp, mkdir, mkdtemp, open, realpath, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { z } from "zod";
import { manifest, sameManifest } from "../src/store/storage-migration/fs";
import {
  acceptStorageMigration,
  inspectStorageMigration,
  migrateStorageRoots,
} from "../src/store/storage-migration/index";
import { paths } from "../src/store/storage-migration/state";

// Run on the repository's filesystem, since tmpfs hides fsync and copy costs.
const { values } = parseArgs({
  options: { source: { type: "string" }, "max-ms": { type: "string" } },
});
const maximum =
  values["max-ms"] === undefined
    ? Number.POSITIVE_INFINITY
    : z.coerce.number().positive().finite().parse(values["max-ms"]);
const directory = await mkdtemp(join(dirname(import.meta.dir), ".migration-benchmark-"));
const p = paths(directory);
const metrics: Record<string, number> = {};
const rounded = (value: number) => Math.round(value * 100) / 100;

try {
  if (values.source) {
    await cp(resolve(values.source), p.legacy, {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      mode: constants.COPYFILE_FICLONE,
    });
    // This is an isolated copy. A copied live PID must not claim the fixture.
    await rm(join(p.legacy, "sidecar.lock"), { force: true });
  } else {
    const content = Buffer.alloc(4096, 0x5a);
    for (let bucket = 0; bucket < 32; bucket += 1) {
      const target = join(p.legacy, "objects", String(bucket));
      await mkdir(target, { recursive: true });
      await Promise.all(
        Array.from({ length: 64 }, (_, file) => writeFile(join(target, `${file}.bin`), content)),
      );
    }
    const large = await open(join(p.legacy, "objects", "large.bin"), "wx");
    try {
      const chunk = Buffer.alloc(1024 * 1024, 0xa5);
      for (let i = 0; i < 256; i += 1) await large.writeFile(chunk);
    } finally {
      await large.close();
    }
  }
  const original = await manifest(p.legacy, "durable");
  const files = original.filter((entry) => entry.kind === "file");
  const bytes = files.reduce((total, entry) => total + entry.size, 0);
  assert.deepEqual(await inspectStorageMigration([directory]), { required: true });
  let stage = "plan";
  let stageStarted = performance.now();
  const start = stageStarted;
  const finishStage = () => {
    metrics[stage] = (metrics[stage] ?? 0) + performance.now() - stageStarted;
  };
  await migrateStorageRoots([directory], (step) => {
    if (step === stage) return;
    finishStage();
    stage = step;
    stageStarted = performance.now();
  });
  finishStage();
  metrics.migrationMs = performance.now() - start;
  const acceptStarted = performance.now();
  await acceptStorageMigration([directory]);
  metrics.acceptanceMs = performance.now() - acceptStarted;
  metrics.totalMs = performance.now() - start;
  const inspectStarted = performance.now();
  assert.deepEqual(await inspectStorageMigration([directory]), { required: false });
  metrics.acceptedInspectionMs = performance.now() - inspectStarted;
  assert.equal(await realpath(p.legacy), await realpath(p.current));
  assert(sameManifest(await manifest(join(p.originals, "legacy")), original));
  assert(sameManifest(await manifest(p.current), original), "Published contents must match hashes");
  console.log(
    JSON.stringify(
      {
        ok: metrics.totalMs <= maximum,
        files: files.length,
        bytes,
        ...Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, rounded(value)])),
      },
      null,
      2,
    ),
  );
  assert(metrics.totalMs <= maximum, `Migration exceeds ${maximum}ms`);
} finally {
  await rm(directory, { recursive: true, force: true });
}
