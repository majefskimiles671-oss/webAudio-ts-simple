import { openDB } from "idb";
import type { StorageProvider, Recording } from "./StorageProvider";

export class LocalStorageProvider implements StorageProvider {
  private dbPromise = openDB("audioDB", 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("audio")) {
        db.createObjectStore("audio", { keyPath: "id" });
      }
    }
  });

  // async save(blob: Blob): Promise<string> {
  //   const id = crypto.randomUUID();
  //   const timestamp = Date.now();
  //   const duration  = 0; //Not Sure about this

  //   const db = await this.dbPromise;
  //   await db.put("audio", { id, timestamp, blob, duration, name: "Track " + (timestamp % 10000) });

  //   return id;
  // }


  async save(blob: Blob, name: string, duration: number): Promise<string> {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    const db = await this.dbPromise;
    await db.put("audio", {
      id,
      timestamp,
      blob,
      duration,   // <<< ADD THIS
      name: name,
      gain: 1,
    });
    return id;
  }




  async get(id: string): Promise<Blob> {
    const db = await this.dbPromise;
    const item = await db.get("audio", id);
    if (!item) throw new Error("Audio not found: " + id);
    return item.blob;
  }


  async list(): Promise<Recording[]> {
    const db = await this.dbPromise;
    const items = await db.getAll("audio");

    return items.map(item => ({
      id: item.id,
      timestamp: item.timestamp,
      duration: item.duration,
      name: item.name ?? null,   // Explicitly return null if missing
      gain: item.gain ?? 1,      // Default gain 1 if missing
    }));
  }


  async delete(id: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete("audio", id);
  }


  async updateTrackName(id: string, newName: string) {
    console.log(`updating track name: ${newName}`);
    const db = await this.dbPromise; // or via storage method
    const item = await db.get("audio", id);
    if (!item) return;

    item.name = newName;
    await db.put("audio", item);
  }

}