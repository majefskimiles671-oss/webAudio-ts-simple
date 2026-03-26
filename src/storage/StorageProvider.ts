// src/storage/StorageProvider.ts
export interface StoredAudio {
  id: string;
  timestamp: number;
}

export interface StorageProvider {
  save(blob: Blob): Promise<string>;
  get(id: string): Promise<Blob>;
  list(): Promise<{ id: string; timestamp: number }[]>;
  delete(id: string): Promise<void>;
}

export interface Recording {
  id: string;
  name?: string;
  timestamp: number;
  gain?: number; // optional for now
}