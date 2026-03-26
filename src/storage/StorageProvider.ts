// src/storage/StorageProvider.ts
export interface StoredAudio {
  id: string;
  timestamp: number;
}

export interface StorageProvider {
  save(blob: Blob): Promise<string>;
}