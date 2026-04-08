import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { writeFileFromBrowser, readFileForBrowser } from "./write_file.js";

const app = express();
const PORT = 3000;

// Required because __dirname doesn't exist in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static frontend
app.use(express.static(path.join(__dirname, "public")));

// IMPORTANT: allow raw binary uploads
app.use(
  express.raw({
    type: "application/octet-stream",
    limit: "50mb",
  })
);

// Endpoint that accepts OPFS bytes
app.post("/save-from-opfs", async (req, res) => {
  try {
    const filename =
      (req.query.name as string) ??
      `opfs-${Date.now()}.bin`;

    const data = new Uint8Array(req.body);

    await writeFileFromBrowser(filename, data);

    res.json({ ok: true, filename });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});


app.get("/load-to-opfs", async (req, res) => {
  try {
    const relativePath = req.query.name as string;

    const data = await readFileForBrowser(relativePath);

    res.setHeader("Content-Type", "application/octet-stream");
    // res.send(data);
    res.send(Buffer.from(data));
  } catch (err) {
    console.error(err);
    res.status(404).json({ ok: false, error: "File not found" });
  }
});


app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
