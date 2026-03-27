// src/storage/StorageProvider.ts

export interface Recording {
  id: string;
  timestamp: number;

  name: string | null;
  gain: number;
  duration: number;
}

export interface StoredAudio extends Recording {
  blob?: Blob;
}

export interface StorageProvider {
  save(blob: Blob, duration: number, name?: string): Promise<string>;
  get(id: string): Promise<Blob>;
  list(): Promise<Recording[]>;
  delete(id: string): Promise<void>;
  updateName(id: string, name: string): Promise<void>;
  updateGain(id: string, gain: number): Promise<void>;
}