export interface OpfsBridge {
  write(path: string, data: string | ArrayBuffer | Uint8Array): Promise<void>;
  read(path: string): Promise<ArrayBuffer>;
  push(path: string): Promise<void>;
  pull(path: string): Promise<void>;
}

export class DefaultOpfsBridge implements OpfsBridge {
    constructor(private debug = false) {}

  async write(
    path: string,
    data: string | ArrayBuffer | Uint8Array,
  ): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const { dir, name } = await this.ensurePath(root, path);

    const handle = await dir.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    await writable.write(this.normalize(data));
    await writable.close();
  }

  async read(path: string): Promise<ArrayBuffer> {
    const root = await navigator.storage.getDirectory();
    const { dir, name } = await this.ensurePath(root, path);

    const file = await (await dir.getFileHandle(name)).getFile();
    return await file.arrayBuffer();
  }

  async push(path: string): Promise<void> {
    const data = await this.read(path);

    await fetch(`/bridge/push?path=${encodeURIComponent(path)}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: data,
    });
  }

  async pull(path: string): Promise<void> {
    const res = await fetch(`/bridge/pull?path=${encodeURIComponent(path)}`);

    if (!res.ok) {
      throw new Error(`pull failed: ${path}`);
    }

    const data = await res.arrayBuffer();

    // debugging
    if (this.debug) {
        this.debugLogging(data, path);
    }

    await this.write(path, data);
  }

  // ------- internals -------

  private async ensurePath(
    root: FileSystemDirectoryHandle,
    fullPath: string,
  ): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const parts = fullPath.split("/").filter(Boolean);
    const name = parts.pop()!;

    let dir = root;
    for (const part of parts) {
      dir = await dir.getDirectoryHandle(part, { create: true });
    }

    return { dir, name };
  }

  private normalize(
    data: string | ArrayBuffer | Uint8Array,
  ): string | ArrayBuffer {
    if (typeof data === "string") {
      return data;
    }
    if (data instanceof Uint8Array) {
      return new Uint8Array(data).buffer;
    }
    return data;
  }

  private debugLogging(buffer: any, relPath: string) {
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
  }
}
