// document.addEventListener("DOMContentLoaded", async () => {
//   console.log("hello from ts in fs bridge demo, writing a file");

//   await fetch("/write-test-file", {
//     method: "POST",
//   });
// });

// src/public/browser.ts

let opfsFileHandle: FileSystemFileHandle | null = null;

const relativePath = "ideas/session-001/idea.txt";

async function sendOpfsToBackend() {
  if (!opfsFileHandle) {
    alert("Write OPFS file first");
    return;
  }

  const file = await opfsFileHandle.getFile();
  const buffer = await file.arrayBuffer();

  const res = await fetch(
    `/save-from-opfs?name=${encodeURIComponent(relativePath)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
      },
      body: buffer,
    },
  );

  alert(res.ok ? "Saved to real filesystem!" : "Save failed");
}

function normalizeForOpfsWrite(
  data: string | ArrayBuffer | Uint8Array,
): string | ArrayBuffer {
  if (typeof data === "string") {
    return data;
  }

  if (data instanceof Uint8Array) {
    // ✅ Forces a real ArrayBuffer
    return new Uint8Array(data).buffer;
  }

  if (data instanceof ArrayBuffer) {
    return data;
  }

  // This is unreachable today, but keeps TS honest
  throw new Error("Unsupported data type for OPFS write");
}

async function writeFileToOpfs(
  relativePath: string,
  data: string | ArrayBuffer | Uint8Array,
): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();

  const parts = relativePath.split("/");
  const filename = parts.pop()!;
  const dirPath = parts.join("/");

  const dir = dirPath ? await ensureOpfsDirectory(root, dirPath) : root;

  const fileHandle = await dir.getFileHandle(filename, {
    create: true,
  });

  const writable = await fileHandle.createWritable();
  await writable.write(normalizeForOpfsWrite(data));
  await writable.close();

  return fileHandle;
}

async function ensureOpfsDirectory(
  root: FileSystemDirectoryHandle,
  path: string,
): Promise<FileSystemDirectoryHandle> {
  const parts = path.split("/").filter(Boolean);
  let current = root;

  for (const part of parts) {
    current = await current.getDirectoryHandle(part, {
      create: true,
    });
  }

  return current;
}

async function loadFromBackendToOpfs() {
  const relativePath = "ideas/heelo.txt";

  const res = await fetch(
    `/load-to-opfs?name=${encodeURIComponent(relativePath)}`,
  );

  if (!res.ok) {
    alert("Failed to load file from backend");
    return;
  }

  const buffer = await res.arrayBuffer();

  await writeFileToOpfs(relativePath, buffer);

  alert("File loaded into OPFS!");
}

document
  .getElementById("writeOpfs")!
  .addEventListener("click", async () => {
    opfsFileHandle = await writeFileToOpfs(
      relativePath,
      "Hello from OPFS button\n" + new Date().toISOString(),
    );
  });

document
  .getElementById("sendOpfs")!
  .addEventListener("click", sendOpfsToBackend);

document
  .getElementById("loadFromBackend")!
  .addEventListener("click", loadFromBackendToOpfs);
