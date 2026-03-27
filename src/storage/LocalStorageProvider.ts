// src/storage/LocalStorageProvider.ts
import type { StorageProvider, Recording } from "./StorageProvider.js";
import { openDB } from "idb";

export class LocalStorageProvider implements StorageProvider {
  dbPromise = openDB("audioDB", 2, {
    upgrade(db, oldVersion, newVersion, transaction) {
      let store;

      if (!db.objectStoreNames.contains("audio")) {
        store = db.createObjectStore("audio", { keyPath: "id" });
      } else {
        store = transaction.objectStore("audio");
      }

      if (!store.indexNames.contains("name")) {
        store.createIndex("name", "name");
      }
    }
  });

  async save(blob: Blob, duration: number, name?: string): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    const db = await this.dbPromise;
    await db.put("audio", {
      id,
      timestamp,
      blob,
      duration,
      name: name ?? `Track ${timestamp}`,
      gain: 1
    });

    return id;
  }

  async get(id: string): Promise<Blob> {
    const db = await this.dbPromise;
    const item = await db.get("audio", id);
    if (!item) throw new Error("Not found");
    return item.blob;
  }

  async list(): Promise<Recording[]> {
    const db = await this.dbPromise;
    const items = await db.getAll("audio");

    return items.map(item => ({
      id: item.id,
      timestamp: item.timestamp,
      name: item.name ?? null,
      gain: item.gain ?? 1,
      duration: item.duration ?? 0
    }));
  }

  async delete(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete("audio", id);
  }

  async updateName(id: string, name: string): Promise<void> {
    const db = await this.dbPromise;
    const item = await db.get("audio", id);
    if (!item) return;
    item.name = name;
    await db.put("audio", item);
  }

  async updateGain(id: string, gain: number): Promise<void> {
    const db = await this.dbPromise;
    const item = await db.get("audio", id);
    if (!item) return;
    item.gain = gain;
    await db.put("audio", item);
  }
}