import { describe, expect, test } from "bun:test";
import {
  clampTaskFooterHeight,
  defaultTaskFooterHeight,
  resetTaskFooterHeight,
} from "./TaskFooter.tsx";

describe("task footer sizing", () => {
  test("defaults to 40% of the panel", () => {
    expect(defaultTaskFooterHeight(1_000)).toBe(400);
  });

  test("clamps to the 176px usable minimum", () => {
    expect(clampTaskFooterHeight(1_000, 120)).toBe(176);
  });

  test("clamps to 65% of the panel", () => {
    expect(clampTaskFooterHeight(1_000, 900)).toBe(650);
  });

  test("resets to the 40% default", () => {
    expect(resetTaskFooterHeight(1_000)).toBe(400);
  });
});
