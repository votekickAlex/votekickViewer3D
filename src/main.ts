import { convertFileSrc } from "@tauri-apps/api/core";
import { Viewer } from "./viewer";
import { isSupportedFile, loadFromArrayBuffer, setResourceBase } from "./loader";
import { loadSettings, setSetting, settings } from "./settings";
import { createMenuBar, type MenuDef } from "./menu";

const APP_TITLE = "!votekickViewer3D";

const viewport = document.getElementById("viewport")!;
const statusEl = document.getElementById("status")!;
const dropHint = document.getElementById("drop-hint")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
const settingsDialog = document.getElementById("settings-dialog") as HTMLDialogElement;
const pluginsDialog = document.getElementById("plugins-dialog") as HTMLDialogElement;
const loadingOverlay = document.createElement("div");

loadingOverlay.id = "loading";
loadingOverlay.hidden = true;
loadingOverlay.innerHTML = `
  <div id="loading-text">Loading…</div>
  <div id="loading-bar"><div id="loading-bar-fill"></div></div>`;
document.body.appendChild(loadingOverlay);

const viewer = new Viewer(viewport);

// Saved settings (grid, wireframe) must be applied to the viewer before the
// menu binds, so checkmarks reflect the loaded state.
await loadSettings();
viewer.setGridVisible(settings.view.grid);
viewer.setWireframe(settings.view.wireframe);

// ---------- shared actions (menu + hotkeys) ----------

function toggleGrid(): void {
  viewer.setGridVisible(!viewer.gridVisible);
  setSetting("view", "grid", viewer.gridVisible);
}

function toggleWireframe(): void {
  viewer.setWireframe(!viewer.wireframeOn);
  setSetting("view", "wireframe", viewer.wireframeOn);
}

function openFileDialog(): void {
  fileInput.click();
}

function showSettings(): void {
  const launchMaximized = document.getElementById("set-launch-maximized") as HTMLInputElement;
  launchMaximized.checked = settings.window.launchMaximized;
  settingsDialog.showModal();
}

// ---------- menu bar ----------

const menus: MenuDef[] = [
  {
    label: "File",
    items: [{ label: "Open…", hint: "Ctrl+O", action: openFileDialog }],
  },
  {
    label: "View",
    items: [
      { label: "Grid", hint: "G", checked: () => viewer.gridVisible, action: toggleGrid },
      { label: "Wireframe", hint: "F", checked: () => viewer.wireframeOn, action: toggleWireframe },
      { label: "Reset view", hint: "R", action: () => viewer.frameModel() },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "Settings…", action: showSettings },
      { label: "Plugins…", action: () => pluginsDialog.showModal() },
    ],
  },
];

createMenuBar(document.getElementById("menubar")!, menus);

document.getElementById("settings-close")!.addEventListener("click", () => settingsDialog.close());
document.getElementById("plugins-close")!.addEventListener("click", () => pluginsDialog.close());

document.getElementById("set-launch-maximized")!.addEventListener("change", (e) => {
  setSetting("window", "launchMaximized", (e.target as HTMLInputElement).checked);
});

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

/** Entry point for drag&drop and the file dialog. */
async function openFile(file: File): Promise<void> {
  if (!isSupportedFile(file.name)) {
    setStatus(`Unsupported file: ${file.name}`, true);
    return;
  }
  // Dropped files arrive alone; any stale sidecar texture base is invalid here.
  setResourceBase("");
  try {
    const buffer = await readFile(file, (p) => setLoading(true, `Loading ${file.name}…`, p));
    await loadModel(buffer, file.name);
  } catch (err) {
    handleLoadError(err, file.name);
  }
}

/** Entry point for files opened through the OS (command line / Explorer). */
async function openPath(path: string): Promise<void> {
  if (!isSupportedFile(path)) {
    setStatus(`Unsupported file: ${path}`, true);
    return;
  }
  const name = basename(path);
  setLoading(true, `Loading ${name}…`, 0);
  try {
    const res = await fetch(convertFileSrc(path));
    if (!res.ok) throw new Error(`Cannot read file (HTTP ${res.status})`);
    // Sidecar textures (FBX/OBJ) resolve relative to the model's folder,
    // so the base must be known before parsing starts.
    setResourceBase(convertFileSrc(dirname(path)));
    const buffer = await res.arrayBuffer();
    await loadModel(buffer, name);
  } catch (err) {
    handleLoadError(err, name);
  }
}

async function loadModel(buffer: ArrayBuffer, name: string): Promise<void> {
  const seq = ++loadingSeq;
  setLoading(true, `Loading ${name}…`, 1);

  try {
    const result = await loadFromArrayBuffer(buffer, name);
    if (seq !== loadingSeq) return; // superseded by another open

    viewer.setModel(result.object);
    setStatus(`${name}  ·  ${(buffer.byteLength / 1024 / 1024).toFixed(1)} MB`);
    document.title = `${name} — ${APP_TITLE}`;
  } catch (err) {
    if (seq !== loadingSeq) return;
    handleLoadError(err, name);
  } finally {
    if (seq === loadingSeq) setLoading(false);
  }
}

function handleLoadError(err: unknown, name: string): void {
  viewer.clearModel();
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  const line = `Failed: ${name} — ${message}`;
  setStatus(line, true);
  void logError(line);
}

function readFile(file: File, onProgress: (p: number) => void): Promise<ArrayBuffer> {
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

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i >= 0 ? path.slice(i + 1) : path;
}

function dirname(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : ".";
}

// ---------- keyboard ----------

window.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  const key = e.key.toLowerCase();
  if (key === "g") toggleGrid();
  else if (key === "f") toggleWireframe();
  else if (key === "r") viewer.frameModel();
  else if (key === "o" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    openFileDialog();
  }
});

// ---------- error log (log.txt next to the exe, AppData fallback) ----------

async function logError(message: string): Promise<void> {
  if (!("__TAURI_INTERNALS__" in window)) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("log_error", { message });
  } catch (err) {
    console.warn("Could not write to log", err);
  }
}

// ---------- OS integration (only runs inside the Tauri webview) ----------

if ("__TAURI_INTERNALS__" in window) {
  const { invoke } = await import("@tauri-apps/api/core");
  const { getCurrentWebview } = await import("@tauri-apps/api/webview");
  const { getCurrentWindow } = await import("@tauri-apps/api/window");

  // A path given on first launch, before the frontend was listening.
  const initial = await invoke<string | null>("initial_file");
  if (initial) openPath(initial);

  // Files routed from a second app instance (single-instance plugin).
  await getCurrentWebview().listen<string>("open-file", (event) => openPath(event.payload));

  // Remember window size (logical px, matching the backend's LogicalSize
  // restore). Rapid resize events coalesce through saveSettingsSoon.
  // Maximized windows are skipped: their size is not a windowed size.
  await getCurrentWindow().onResized(async () => {
    if (await getCurrentWindow().isMaximized()) return;
    setSetting("window", "width", window.innerWidth);
    setSetting("window", "height", window.innerHeight);
  });
}
