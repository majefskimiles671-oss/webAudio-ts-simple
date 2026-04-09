import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const ROOT = "/Users/miles.majefski/fs-bridge-test";

export async function writeToDisk(
  relativePath: string,
  data: Uint8Array
) {
  const fullPath = path.join(ROOT, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
}

export async function readFromDisk(
  relativePath: string
): Promise<Uint8Array> {
  const fullPath = path.join(ROOT, relativePath);
  const buf = await readFile(fullPath);
  return new Uint8Array(buf);
}