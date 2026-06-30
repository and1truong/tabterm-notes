import type { ServerHost } from "@tabterm/module-host/server";
import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp",
};

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Pure: uploadDir injected so this tests without the host. Returns the same
// { url: "/uploads/<hash>.<ext>" } shape core returned (core still serves it).
export async function handleUpload(req: Request, uploadDir: string): Promise<Response> {
  let form: FormData;
  try { form = await req.formData(); }
  catch { return Response.json({ error: "invalid form" }, { status: 400 }); }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "missing file" }, { status: 400 });
  const ext = ALLOWED_MIME[file.type];
  if (!ext) return Response.json({ error: "unsupported type" }, { status: 415 });
  if (file.size > MAX_BYTES) return Response.json({ error: "too large" }, { status: 413 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = await sha256Hex(bytes);
  const name = `${hash}.${ext}`;
  await mkdir(uploadDir, { recursive: true });
  const target = join(uploadDir, name);
  let exists = false;
  try { await stat(target); exists = true; } catch {}
  if (!exists) await Bun.write(target, bytes);
  return Response.json({ url: `/uploads/${name}` });
}

export function registerUploadRoute(host: ServerHost): void {
  const uploadDir = join(host.dataDir, "uploads");
  host.registerRoute("POST", "/upload", (req) => handleUpload(req, uploadDir));
}
