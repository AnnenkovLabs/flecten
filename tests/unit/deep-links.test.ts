import { expect, test } from "bun:test";
import { tmpdir } from "node:os";

const { parseSessionLink, installSessionLinks } = require("../../shell/deep-links.mjs") as {
  parseSessionLink(value: string): { id: string; project: string } | null;
  installSessionLinks(options: {
    app: unknown;
    automated: boolean;
    argv: string[];
    openProject: (path: string) => unknown;
    emit: (event: unknown) => void;
    focus: () => void;
  }): { listening(): void; status(): void };
};

test("task links accept explicit project and session id without commands", () => {
  const project = encodeURIComponent(tmpdir());
  expect(parseSessionLink(`flecten://session/s_hello-1?project=${project}`)).toEqual({
    id: "s_hello-1",
    project: tmpdir(),
  });
  expect(parseSessionLink(`liquid-harness://session/s_hello-1?project=${project}`)).toEqual({
    id: "s_hello-1",
    project: tmpdir(),
  });
  for (const url of [
    `https://session/s_hello?project=${project}`,
    `flecten://session/s_hello?project=${project}&prompt=run`,
    `flecten://session/s_hello?project=relative`,
    `flecten://session/..%2Foutside?project=${project}`,
    `flecten://session/s_hello?project=${project}&project=${project}`,
    `flecten://user:pass@session/s_hello?project=${project}`,
  ])
    expect(parseSessionLink(url)).toBeNull();
});

test("links queue for the listening renderer, then select sessions without running prompts", () => {
  const handlers = new Map<string, (...args: unknown[]) => void>();
  const events: unknown[] = [];
  const projects: string[] = [];
  const link = `flecten://session/s_existing?project=${encodeURIComponent(tmpdir())}`;
  let registered = false;
  const links = installSessionLinks({
    app: {
      isPackaged: true,
      on: (type: string, handler: (...args: unknown[]) => void) => handlers.set(type, handler),
      setAsDefaultProtocolClient: () => (registered = true),
    },
    automated: false,
    argv: [
      `flecten://session/missing?project=${encodeURIComponent(`${tmpdir()}/liquid-missing-${crypto.randomUUID()}`)}`,
      link,
    ],
    openProject: (project: string) => projects.push(project),
    emit: (event: unknown) => events.push(event),
    focus: () => undefined,
  });
  links.status();
  expect(events).toEqual([]);
  links.listening();
  links.status();
  links.status();
  expect(events).toEqual([{ type: "session.open", id: "s_existing" }]);
  expect(registered).toBe(true);
  handlers.get("second-instance")?.({}, [link.replace("s_existing", "s_second")]);
  expect(events[1]).toEqual({ type: "session.open", id: "s_second" });
  expect(projects).toEqual([tmpdir(), tmpdir()]);
  let prevented = false;
  handlers.get("open-url")?.(
    { preventDefault: () => (prevented = true) },
    link.replace("s_existing", "s_third"),
  );
  expect(prevented).toBe(true);
  expect(events[2]).toEqual({ type: "session.open", id: "s_third" });
});
