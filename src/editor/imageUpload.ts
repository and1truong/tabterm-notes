export async function uploadImage(file: File): Promise<{ url: string } | { error: string }> {
  const form = new FormData();
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch("/api/modules/notes/r/upload", { method: "POST", body: form });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "network error" };
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: "upload failed" }));
    return { error: body.error ?? `http ${res.status}` };
  }
  return res.json();
}
