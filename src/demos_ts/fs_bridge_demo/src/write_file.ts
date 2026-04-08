// src/write_file.ts
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const ROOT_DIR = "/Users/miles.majefski/fs-bridge-test";

export async function writeTestFile(): Promise<void> {
  await mkdir(ROOT_DIR, { recursive: true });

  const filePath = path.join(ROOT_DIR, "hello.txt");
  await writeFile(filePath, "Hello from fs_bridge_demo\n", "utf8");
}