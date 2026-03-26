// src/storage/LocalStorageProvider.ts
import { openDB } from "idb";
import type { StorageProvider, StoredAudio } from "./StorageProvider.js";

export class LocalStorageProvider implements StorageProvider {
  private dbPromise = openDB("audioDB", 1, {
    upgrade(db: any) {
      db.createObjectStore("audio", { keyPath: "id" });
    }
  });

  async save(blob: Blob): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    const db = await this.dbPromise;
    await db.put("audio", { id, timestamp, blob });

    return id;
  }

  async list(): Promise<StoredAudio[]> {
    const db = await this.dbPromise;
    const items = await db.getAll("audio");
    return items.map(({ id, timestamp }) => ({ id, timestamp }));
  }

  async get(id: string): Promise<Blob> {
    const db = await this.dbPromise;
    const item = await db.get("audio", id);
    if (!item) throw new Error("Not found");
    return item.blob;
  }
}