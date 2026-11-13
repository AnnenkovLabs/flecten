import { describe, expect, it } from "bun:test";
import { isBusy, phaseLabel } from "../../ui/src/lib/run-machine";

describe("run phase presentation", () => {
  it("labels every phase", () => {
    expect(phaseLabel("idle")).toBe("готово");
    expect(phaseLabel("running")).toBe("работает");
    expect(phaseLabel("writing")).toBe("пишет");
    expect(phaseLabel("stopped")).toBe("остановлено");
  });

  it("reports busy only while work is in flight", () => {
    expect(isBusy("idle")).toBe(false);
    expect(isBusy("running")).toBe(true);
    expect(isBusy("writing")).toBe(true);
    expect(isBusy("stopped")).toBe(false);
  });
});
