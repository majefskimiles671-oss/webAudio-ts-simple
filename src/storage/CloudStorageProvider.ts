// src/storage/CloudStorageProvider.ts
import type { StorageProvider, StoredAudio } from "./StorageProvider.js";

export class CloudStorageProvider implements StorageProvider {
  delete(id: string): Promise<void> {
    throw new Error("Method not implemented.");
  }
  async save(blob: Blob): Promise<string> {
    const res = await fetch("/api/upload", {
      method: "POST",
      body: blob
    });

    return await res.text(); // return ID
  }

  async list(): Promise<StoredAudio[]> {
    const res = await fetch("/api/list");
    return await res.json();
  }

  async get(id: string): Promise<Blob> {
    const res = await fetch(`/api/get?id=${id}`);
    return await res.blob();
  }
}