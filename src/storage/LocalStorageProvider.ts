import { openDB } from "idb";
import type { StorageProvider } from "./StorageProvider";

export class LocalStorageProvider implements StorageProvider {
  private dbPromise = openDB("audioDB", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("audio")) {
        db.createObjectStore("audio", { keyPath: "id" });
      }
    }
  });

  async save(blob: Blob): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    const db = await this.dbPromise;
    await db.put("audio", { id, timestamp, blob });

    return id;
  }

  async get(id: string): Promise<Blob> {
    const db = await this.dbPromise;
    const item = await db.get("audio", id);
    if (!item) throw new Error("Audio not found: " + id);
    return item.blob;
  }

  async list(): Promise<{ id: string; timestamp: number }[]> {
    const db = await this.dbPromise;
    const items = await db.getAll("audio");
    return items.map(({ id, timestamp }) => ({ id, timestamp }));
  }

  async delete(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete("audio", id);
  }
}