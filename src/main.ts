import { Viewer } from "./viewer";
import { isSupportedFile, loadFromArrayBuffer } from "./loader";

const viewport = document.getElementById("viewport")!;
const statusEl = document.getElementById("status")!;
const dropHint = document.getElementById("drop-hint")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const loadingOverlay = document.createElement("div");

loadingOverlay.id = "loading";
loadingOverlay.hidden = true;
loadingOverlay.innerHTML = `
  <div id="loading-text">Loading…</div>
  <div id="loading-bar"><div id="loading-bar-fill"></div></div>`;
document.body.appendChild(loadingOverlay);

const viewer = new Viewer(viewport);

// ---------- toolbar ----------

function bindToggle(id: string, get: () => boolean, set: (v: boolean) => void): void {
  const btn = document.getElementById(id) as HTMLButtonElement;
  const refresh = () => btn.classList.toggle("toggled", get());
  btn.addEventListener("click", () => {
    set(!get());
    refresh();
  });
  refresh();
}

bindToggle("btn-grid", () => viewer.gridVisible, (v) => viewer.setGridVisible(v));
bindToggle("btn-wireframe", () => viewer.wireframeOn, (v) => viewer.setWireframe(v));

document.getElementById("btn-reset")!.addEventListener("click", () => viewer.frameModel());
document.getElementById("btn-open")!.addEventListener("click", () => fileInput.click());

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) openFile(fileInput.files[0]);
  fileInput.value = "";
});

// ---------- drag & drop ----------

let dragDepth = 0;

window.addEventListener("dragenter", (e) => {
  e.preventDefault();
  dragDepth++;
  dropHint.hidden = false;
});

window.addEventListener("dragover", (e) => e.preventDefault());

window.addEventListener("dragleave", () => {
  dragDepth--;
  if (dragDepth <= 0) {
    dragDepth = 0;
    dropHint.hidden = true;
  }
});

window.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  dropHint.hidden = true;
  const file = e.dataTransfer?.files?.[0];
  if (file) openFile(file);
});

// ---------- loading ----------

let loadingSeq = 0;

async function openFile(file: File): Promise<void> {
  if (!isSupportedFile(file.name)) {
    setStatus(`Unsupported file: ${file.name}`, true);
    return;
  }

  const seq = ++loadingSeq;
  setLoading(true, `Loading ${file.name}…`, 0);

  try {
    const buffer = await readWithProgress(file, (p) => {
      if (seq === loadingSeq) setLoading(true, `Loading ${file.name}…`, p);
    });
    const result = await loadFromArrayBuffer(buffer, file.name);
    if (seq !== loadingSeq) return; // superseded by another open

    viewer.setModel(result.object);
    setStatus(`${file.name}  ·  ${(file.size / 1024 / 1024).toFixed(1)} MB`);
  } catch (err) {
    if (seq !== loadingSeq) return;
    viewer.clearModel();
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    setStatus(`Failed: ${message}`, true);
  } finally {
    if (seq === loadingSeq) setLoading(false);
  }
}

function readWithProgress(file: File, onProgress: (p: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (e) => {
      if (e.lengthComputable && e.loaded > 0) onProgress(e.loaded / e.total);
    };
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("File read error"));
    reader.readAsArrayBuffer(file);
  });
}

function setLoading(on: boolean, text?: string, progress = 0): void {
  loadingOverlay.hidden = !on;
  if (on) {
    const textEl = loadingOverlay.querySelector("#loading-text")!;
    const fill = loadingOverlay.querySelector<HTMLElement>("#loading-bar-fill")!;
    if (text) textEl.textContent = text;
    fill.style.width = `${Math.round(progress * 100)}%`;
  }
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.title = text;
  statusEl.style.color = isError ? "#f28b82" : "";
}

// ---------- keyboard ----------

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  if (key === "g") (document.getElementById("btn-grid") as HTMLButtonElement).click();
  else if (key === "f") (document.getElementById("btn-wireframe") as HTMLButtonElement).click();
  else if (key === "r") viewer.frameModel();
  else if (key === "o" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    fileInput.click();
  }
});
