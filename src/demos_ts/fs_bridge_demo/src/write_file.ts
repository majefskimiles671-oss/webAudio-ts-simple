
import { mkdir, writeFile } from "fs/promises";
import path from "path";

const ROOT_DIR = "/Users/miles.majefski/fs-bridge-test";

export async function writeFileFromBrowser(
  relativePath: string,
  data: Uint8Array
) {
  const fullPath = path.join(ROOT_DIR, relativePath);

  // ✅ Create missing directories (mkdir -p semantics)
  await mkdir(path.dirname(fullPath), { recursive: true });

  await writeFile(fullPath, data);
}
