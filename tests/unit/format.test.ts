import { describe, expect, it } from "bun:test";
import { formatNumber, formatTokens, plural } from "../../ui/src/lib/format";

function files(count: number): string {
  return `${count} ${plural(count, "файл", "файла", "файлов")}`;
}

describe("plural", () => {
  it("uses the singular for one and 21", () => {
    expect(files(1)).toBe("1 файл");
    expect(files(21)).toBe("21 файл");
  });

  it("uses the few form for two to four", () => {
    expect(files(2)).toBe("2 файла");
    expect(files(4)).toBe("4 файла");
    expect(files(22)).toBe("22 файла");
  });

  it("uses the many form for zero, five and teens", () => {
    expect(files(0)).toBe("0 файлов");
    expect(files(5)).toBe("5 файлов");
    expect(files(11)).toBe("11 файлов");
    expect(files(14)).toBe("14 файлов");
  });
});

describe("formatTokens", () => {
  it("uses millions for large windows", () => {
    expect(formatTokens(1_000_000)).toBe("1M");
    expect(formatTokens(1_500_000)).toBe("1.5M");
  });

  it("rounds thousands", () => {
    expect(formatTokens(105_000)).toBe("105K");
    expect(formatTokens(38_400)).toBe("38K");
  });

  it("keeps small values as is", () => {
    expect(formatTokens(512)).toBe("512");
  });
});

describe("formatNumber", () => {
  it("groups thousands for Russian", () => {
    expect(formatNumber(6972)).toBe("6\u00A0972");
  });
});
