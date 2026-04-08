
// src/server.ts
// curl -X POST http://localhost:3000/write-test-file
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { writeTestFile } from "./write_file.js";

const app = express();
const PORT = 3000;

// Needed because __dirname doesn't exist in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files
app.use(
  express.static(
    path.join(__dirname, "public")
  )
);

// Endpoint that triggers the write
app.post("/write-test-file", async (_req, res) => {
  try {
    await writeTestFile();
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ok: false });
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});