import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { writeToDisk, readFromDisk } from "./fsBackend.js";

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(express.static(path.join(__dirname, "public")));

app.use(
  express.raw({
    type: "application/octet-stream",
    limit: "100mb",
  })
);

// OPFS → filesystem
app.post("/bridge/push", async (req, res) => {
  const relPath = req.query.path as string;
  await writeToDisk(relPath, new Uint8Array(req.body));
  res.json({ ok: true });
});

// filesystem → OPFS
app.get("/bridge/pull", async (req, res) => {
  const relPath = req.query.path as string;
  const data = await readFromDisk(relPath);
  res.setHeader("Content-Type", "application/octet-stream");
  res.send(Buffer.from(data));
});

app.listen(PORT, () => {
  console.log(`bridge running at http://localhost:${PORT}`);
});
``