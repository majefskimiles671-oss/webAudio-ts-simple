async function ensureDir(root: FileSystemDirectoryHandle, path: string) {
  let cur = root;
  for (const part of path.split("/").filter(Boolean)) {
    cur = await cur.getDirectoryHandle(part, { create: true });
  }
  return cur;
}

function normalize(
  data: string | ArrayBuffer | Uint8Array,
): string | ArrayBuffer {
  if (typeof data === "string") return data;
  if (data instanceof Uint8Array) return new Uint8Array(data).buffer;
  return data;
}

export async function writeOpfs(
  relPath: string,
  data: string | ArrayBuffer | Uint8Array,
): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();
  const parts = relPath.split("/");
  const name = parts.pop()!;
  const dir = parts.length ? await ensureDir(root, parts.join("/")) : root;

  const handle = await dir.getFileHandle(name, { create: true });
  const w = await handle.createWritable();
  await w.write(normalize(data));
  await w.close();
  return handle;
}

export async function readOpfs(relPath: string): Promise<ArrayBuffer> {
  const root = await navigator.storage.getDirectory();
  const parts = relPath.split("/");
  const name = parts.pop()!;
  const dir = parts.length ? await ensureDir(root, parts.join("/")) : root;

  const file = await (await dir.getFileHandle(name)).getFile();
  return await file.arrayBuffer();
}

export async function pushToBackend(relPath: string, data: ArrayBuffer) {
  await fetch(`/bridge/push?path=${encodeURIComponent(relPath)}`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: data,
  });
}

export async function pullFromBackend(relPath: string): Promise<ArrayBuffer> {
  const res = await fetch(`/bridge/pull?path=${encodeURIComponent(relPath)}`);
  if (!res.ok) throw new Error("pull failed");
  // return await res.arrayBuffer();

  const buffer = await res.arrayBuffer();

  // ✅ Debug logging (text-safe)
  try {
    const text = new TextDecoder("utf-8").decode(buffer);
    console.log(`[bridge pull] ${relPath} (decoded text):`);
    console.log(text);
  } catch {
    console.log(
      `[bridge pull] ${relPath} (binary, ${buffer.byteLength} bytes)`,
    );
  }

  return buffer;
}

export async function debugPersist() {
  try {
    const granted = await navigator.storage.persist();
    console.log("OPFS persist requested →", granted);
  } catch (err) {
    console.warn("OPFS persist attempt failed", err);
  }
}

debugPersist();
