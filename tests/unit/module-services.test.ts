import { expect, test } from "bun:test";
import { z } from "zod";
import { defineService, ServiceLayer, Services } from "../../src/core/services/registry";

const value = defineService("value@1", z.string(), z.string());
const driver = defineService("driver@1", z.string(), z.string());
const signal = new AbortController().signal;

test("work scheduled after a service returns uses the current generation instead of a retired async context", async () => {
  const old = new ServiceLayer("old", async () => {});
  const next = new ServiceLayer("new", async () => {});
  let layers = [old];
  const services = new Services(() => layers);
  const gate = Promise.withResolvers<void>();
  let later: Promise<string> | undefined;
  old.provide(value, async () => "old");
  old.provide(driver, async () => {
    later = gate.promise.then(() => services.invoke(value, undefined, "x", signal));
    return "scheduled";
  });
  await services.invoke(driver, undefined, "x", signal);
  next.provide(value, async () => "new");
  layers = [next];
  await old.retire();
  gate.resolve();
  expect(await later).toBe("new");
  await next.retire();
});

test("nested services in another chat do not inherit the caller's session overrides", async () => {
  const project = new ServiceLayer("project", async () => {});
  const parent = new ServiceLayer("parent", async () => {});
  const domain = {};
  const child = new Services(() => [project], domain, "child");
  const services = new Services(() => [project, parent], domain, "parent");
  project.provide(value, async () => "project");
  parent.replace(value, async () => "parent-only");
  parent.provide(driver, async () => child.invoke(value, undefined, "x", signal));
  expect(await services.invoke(driver, undefined, "x", signal)).toBe("project");
  await parent.retire();
  await project.retire();
});
