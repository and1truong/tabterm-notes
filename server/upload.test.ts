import { expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleUpload } from "./upload.ts";

const DIR = join(tmpdir(), "notes-upload-test-" + process.pid);

test("rejects a non-image mime type", async () => {
  const fd = new FormData();
  fd.append("file", new Blob(["x"], { type: "text/plain" }), "a.txt");
  const res = await handleUpload(new Request("http://x/upload", { method: "POST", body: fd }), DIR);
  expect(res.status).toBe(415);
});

test("accepts a png and returns a /uploads url", async () => {
  const fd = new FormData();
  fd.append("file", new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }), "a.png");
  const res = await handleUpload(new Request("http://x/upload", { method: "POST", body: fd }), DIR);
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.url).toMatch(/^\/uploads\/[a-f0-9]{64}\.png$/);
});
