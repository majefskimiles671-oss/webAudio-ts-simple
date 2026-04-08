// write_file.ts
import { mkdir, writeFile, readFile } from "fs/promises";
import path from "path";

const ROOT_DIR = "/Users/miles.majefski/fs-bridge-test";

export async function writeFileFromBrowser(
  relativePath: string,
  data: Uint8Array
) {
  const fullPath = path.join(ROOT_DIR, relativePath);
  await mkdir(path.dirname(fullPath), { recursive: true });
  await writeFile(fullPath, data);
}

export async function readFileForBrowser(
  relativePath: string
): Promise<Uint8Array> {
  const fullPath = path.join(ROOT_DIR, relativePath);
  const buffer = await readFile(fullPath);
  return new Uint8Array(buffer);
}