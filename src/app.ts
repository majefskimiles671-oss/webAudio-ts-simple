// src/app.ts
import { AudioRecorder } from "./audio/AudioRecorder.js";
import { LocalStorageProvider } from "./storage/LocalStorageProvider.js";
// import { CloudStorageProvider } from "./storage/CloudStorageProvider.js";

const recorder = new AudioRecorder();
const storage = new LocalStorageProvider();  // ← Swap providers here

const startBtn = document.getElementById("start")!;
const stopBtn = document.getElementById("stop")!;
const listDiv = document.getElementById("list")!;

startBtn.onclick = () => recorder.start();
stopBtn.onclick = async () => {
  const blob = await recorder.stop();
  await storage.save(blob);
  refreshList();
};

async function refreshList() {
  const items = await storage.list();

  listDiv.innerHTML = "";
  for (const item of items) {
    const btn = document.createElement("button");
    btn.textContent = new Date(item.timestamp).toLocaleString();
    btn.onclick = async () => {
      const blob = await storage.get(item.id);
      const url = URL.createObjectURL(blob);
      new Audio(url).play();
    };
    listDiv.appendChild(btn);
  }
}

refreshList();