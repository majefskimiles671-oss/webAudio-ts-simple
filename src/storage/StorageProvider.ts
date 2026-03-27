// src/storage/StorageProvider.ts
// export interface StoredAudio {
//   id: string;
//   timestamp: number;
// }

export interface StorageProvider {
  save(blob: Blob,  duration: number): Promise<string>;
  get(id: string): Promise<Blob>;
  list(): Promise<Recording[]>;
  delete(id: string): Promise<void>;
}

export interface Recording {
  id: string;
  name: string;
  timestamp: number;
  duration: number;
  gain?: number; // optional for now
}