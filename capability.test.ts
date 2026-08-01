import { expect, test } from "bun:test";
import { hasCoreNotesCapability } from "./capability.ts";

test("old core selects the complete legacy notes activation", () => {
  expect(hasCoreNotesCapability({})).toBe(false);
});

test("capable core selects diagram-only activation", () => {
  expect(hasCoreNotesCapability({ notes: { apiVersion: 1 } })).toBe(true);
});

test("unknown future contracts do not silently select the v1 branch", () => {
  expect(hasCoreNotesCapability({ notes: { apiVersion: 2 } })).toBe(false);
});
