import { describe, expect, test } from "bun:test";
import { PROFILE_3, PROFILE_4, toolOutputBudget, toolOutputClass } from "../../src/context";

describe("tool output budget", () => {
  test("derives the budget from the remaining window, not a fixed size", () => {
    const read = toolOutputBudget(
      { contextWindow: 100_000, reserveTokens: 20_000, usedTokens: 20_000 },
      "read",
    );
    const log = toolOutputBudget(
      { contextWindow: 100_000, reserveTokens: 20_000, usedTokens: 20_000 },
      "log",
    );
    const small = toolOutputBudget(
      { contextWindow: 20_000, reserveTokens: 10_000, usedTokens: 5_000 },
      "read",
    );

    expect(read.remainingTokens).toBe(60_000);
    expect(read.tokens).toBe(15_000);
    expect(log.tokens).toBe(6_000);
    expect(read.tokens).toBeGreaterThan(log.tokens);
    expect(small.tokens).toBe(1_250);
    expect(small.chars).toBe(5_000);
  });

  test("never exceeds the remaining window and handles an exhausted window", () => {
    const exhausted = toolOutputBudget(
      { contextWindow: 10_000, reserveTokens: 9_000, usedTokens: 1_500 },
      "read",
    );
    const almost = toolOutputBudget(
      { contextWindow: 1_000, reserveTokens: 0, usedTokens: 990 },
      "read",
    );
    const negative = toolOutputBudget(
      { contextWindow: 1_000, reserveTokens: 0, usedTokens: -500 },
      "read",
    );

    expect(exhausted.tokens).toBe(0);
    expect(exhausted.chars).toBe(0);
    expect(almost.tokens).toBe(10);
    expect(negative.remainingTokens).toBe(1_000);
  });

  test("splits one share across pending calls and honors class caps", () => {
    const single = toolOutputBudget(
      { contextWindow: 200_000, reserveTokens: 16_000, usedTokens: 0 },
      "read",
    );
    const many = toolOutputBudget(
      { contextWindow: 200_000, reserveTokens: 16_000, usedTokens: 0, pendingCalls: 10 },
      "read",
    );
    const zeroCalls = toolOutputBudget(
      { contextWindow: 200_000, reserveTokens: 16_000, usedTokens: 0, pendingCalls: 0 },
      "bash",
    );

    expect(single.tokens).toBe(24_000);
    expect(many.tokens).toBe(4_600);
    expect(zeroCalls.tokens).toBe(8_000);
  });

  test("profile changes the character allowance but not the token budget", () => {
    const four = toolOutputBudget(
      { contextWindow: 50_000, reserveTokens: 5_000, usedTokens: 5_000, profile: PROFILE_4 },
      "search",
    );
    const three = toolOutputBudget(
      { contextWindow: 50_000, reserveTokens: 5_000, usedTokens: 5_000, profile: PROFILE_3 },
      "search",
    );

    expect(three.tokens).toBe(four.tokens);
    expect(three.chars).toBeLessThan(four.chars);
  });

  test("maps tools to explicit output classes", () => {
    expect(toolOutputClass("read")).toBe("read");
    expect(toolOutputClass("grep")).toBe("search");
    expect(toolOutputClass("glob")).toBe("search");
    expect(toolOutputClass("bash")).toBe("bash");
    expect(toolOutputClass("terminal")).toBe("log");
    expect(toolOutputClass("edit")).toBe("default");
  });
});
