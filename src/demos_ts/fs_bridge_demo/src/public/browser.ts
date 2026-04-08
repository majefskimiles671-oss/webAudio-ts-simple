
// document.addEventListener("DOMContentLoaded", async () => {
//   console.log("hello from ts in fs bridge demo, writing a file");

//   await fetch("/write-test-file", {
//     method: "POST",
//   });
// });

// src/public/browser.ts

let opfsFileHandle: FileSystemFileHandle | null = null;

// async function writeOpfsFile() {
//   const root = await navigator.storage.getDirectory();

//   const ideasDir = await root.getDirectoryHandle("ideas", {
//     create: true,
//   });

//   opfsFileHandle = await ideasDir.getFileHandle("idea.txt", {
//     create: true,
//   });

//   const writable = await opfsFileHandle.createWritable();
//   await writable.write(
//     "Hello from OPFS inside /ideas!\n" +
//       new Date().toISOString() +
//       "\n"
//   );
//   await writable.close();

//   alert("Wrote OPFS file in /ideas");
// }
// ✅ Relative path only (no absolute paths!)
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
    }
  );

  alert(res.ok ? "Saved to real filesystem!" : "Save failed");
}


// async function writeFileToOpfs(
//   relativePath: string,
//   contents: string | ArrayBuffer | Uint8Array
// ): Promise<FileSystemFileHandle> {
//   const root = await navigator.storage.getDirectory();

//   const pathParts = relativePath.split("/");
//   const fileName = pathParts.pop()!;
//   const dirPath = pathParts.join("/");

//   const dir = dirPath
//     ? await ensureOpfsDirectory(root, dirPath)
//     : root;

//   const fileHandle = await dir.getFileHandle(fileName, {
//     create: true,
//   });

//   const writable = await fileHandle.createWritable();
//   await writable.write(contents.buffer.slice(0));
//   await writable.close();

//   return fileHandle;
// }


function normalizeForOpfsWrite(
  data: string | ArrayBuffer | Uint8Array
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
  contents: string | ArrayBuffer | Uint8Array
): Promise<FileSystemFileHandle> {
  const root = await navigator.storage.getDirectory();

  const parts = relativePath.split("/");
  const fileName = parts.pop()!;
  const dirPath = parts.join("/");

  const dir = dirPath
    ? await ensureOpfsDirectory(root, dirPath)
    : root;

  const fileHandle = await dir.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();

  if (typeof contents === "string") {
    // ✅ string is allowed
    await writable.write(contents);

  } else if (contents instanceof Uint8Array) {
    // ✅ normalize Uint8Array → ArrayBuffer
    await writable.write(normalizeForOpfsWrite(contents));

  } else {
    // ✅ contents is ArrayBuffer here
    await writable.write(contents);
  }

  await writable.close();
  return fileHandle;
}


async function ensureOpfsDirectory(
  root: FileSystemDirectoryHandle,
  path: string
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


opfsFileHandle = await writeFileToOpfs(
  relativePath,
  "Hello from OPFS\n" + new Date().toISOString()
);
console.log(`file handle: ${opfsFileHandle}`);


document
  .getElementById("writeOpfs")!
  .addEventListener("click", () => (writeFileToOpfs(relativePath, "Hello from OPFS button\n" + new Date().toISOString())));

document
  .getElementById("sendOpfs")!
  .addEventListener("click", sendOpfsToBackend);

