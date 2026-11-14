import { convertFileSrc } from "@tauri-apps/api/core";
import * as THREE from "three";
import { Viewer } from "./viewer";
import { isSupportedFile, loadFromArrayBuffer, setResourceBase, SUPPORTED_EXTENSIONS } from "./loader";
import { loadSettings, saveSettingsSoon, setSetting, settings, type AppSettings } from "./settings";
import { DEFAULTS } from "./settings-schema";
import { createMenuBar, type MenuDef } from "./menu";
import { currentLanguage, englishTemplate, setLanguage, t } from "./i18n";
import { iconSvg } from "./icons";
import { version as APP_VERSION } from "../package.json";

const APP_TITLE = "!votekickViewer3D";

const viewport = document.getElementById("viewport")!;
const statusEl = document.getElementById("status")!;
const dropHint = document.getElementById("drop-hint")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
// The OS dialog must only offer the formats the viewer can actually load.
fileInput.accept = SUPPORTED_EXTENSIONS.join(",");
const settingsDialog = document.getElementById("settings-dialog") as HTMLDialogElement;
const pluginsDialog = document.getElementById("plugins-dialog") as HTMLDialogElement;
const aboutDialog = document.getElementById("about-dialog") as HTMLDialogElement;
const ALL_DIALOGS = [settingsDialog, pluginsDialog, aboutDialog];
const loadingOverlay = document.createElement("div");

loadingOverlay.id = "loading";
loadingOverlay.hidden = true;
loadingOverlay.innerHTML = `
  <div id="loading-icon" class="loading-icon"></div>
  <div id="loading-text">Loading…</div>
  <div id="loading-bar"><div id="loading-bar-fill"></div></div>`;
document.body.appendChild(loadingOverlay);

const viewer = new Viewer(viewport);

// Saved settings (grid, wireframe) must be applied to the viewer before the
// menu binds, so checkmarks reflect the loaded state. The saved language is
// applied before any t() call (menus, dialogs) is made.
await loadSettings();
viewer.setGridVisible(settings.view.grid);
viewer.setWireframe(settings.view.wireframe);
await setLanguage(settings.general.language);

// Inline the animated line-md icons into every element carrying a
// data-icon attribute (dialog headers, about link). Static HTML only;
// menu icons are inserted by menu.ts when a menu opens.
document.querySelectorAll<HTMLElement>("[data-icon]").forEach((el) => {
  el.innerHTML = iconSvg(el.dataset.icon!);
});

// ---------- shared actions (menu + hotkeys) ----------

function toggleGrid(): void {
  viewer.setGridVisible(!viewer.gridVisible);
  setSetting("view", "grid", viewer.gridVisible);
  refreshStatusIcons();
}

function toggleWireframe(): void {
  viewer.setWireframe(!viewer.wireframeOn);
  setSetting("view", "wireframe", viewer.wireframeOn);
  refreshStatusIcons();
}

/** View > Bounding box (hotkey B): cube edges around the whole model. */
function toggleBBox(): void {
  viewer.setBBoxVisible(!viewer.bboxVisible);
  refreshStatusIcons();
}

function openFileDialog(): void {
  fileInput.click();
}

/** A model is opening: modal dialogs must not stay above the loading. */
function closeDialogsForModelOpen(): void {
  for (const dialog of ALL_DIALOGS) {
    if (dialog.open) dialog.close();
  }
}

// ---------- full screen & interface ----------

let fullscreenOn = false;

/** Icons in the status bar reflecting the enabled View states; titles are
 * re-read so a language switch updates them too. */
function refreshStatusIcons(): void {
  const states: [string, () => boolean, () => string][] = [
    ["st-grid", () => viewer.gridVisible, () => t("menu.grid")],
    ["st-wireframe", () => viewer.wireframeOn, () => t("menu.wireframe")],
    ["st-bbox", () => viewer.bboxVisible, () => t("menu.boundingBox")],
    ["st-fullscreen", () => fullscreenOn, () => t("menu.fullscreen")],
  ];
  for (const [id, on, title] of states) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.toggle("on", on());
    el.title = title();
  }
}

async function toggleFullscreen(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const window = getCurrentWindow();
    fullscreenOn = !(await window.isFullscreen());
    await window.setFullscreen(fullscreenOn);
  } else {
    // Dev-server fallback in a plain browser.
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      fullscreenOn = false;
    } else {
      await document.documentElement.requestFullscreen();
      fullscreenOn = true;
    }
  }
  refreshStatusIcons();
}

async function quitApp(): Promise<void> {
  if ("__TAURI_INTERNALS__" in window) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().close();
  } else {
    window.close();
  }
}

let uiHidden = false;

/** View > Interface (hotkey H): hide the whole UI, leaving only the 3D
 * viewport, for clean screenshots. Press H again to bring it back. */
function toggleInterface(): void {
  uiHidden = !uiHidden;
  document.body.classList.toggle("ui-hidden", uiHidden);
}

// ---------- hotkeys (editable in the Settings dialog) ----------

type HotkeyKey = keyof AppSettings["hotkeys"];

/** The bound actions, shared by the menu, the global key listener and
 * the Settings rows. */
const HOTKEY_ACTIONS: { key: HotkeyKey; label: () => string; run: () => void }[] = [
  { key: "open", label: () => t("hotkeys.open"), run: openFileDialog },
  { key: "grid", label: () => t("hotkeys.grid"), run: toggleGrid },
  { key: "wireframe", label: () => t("hotkeys.wireframe"), run: toggleWireframe },
  { key: "boundingBox", label: () => t("hotkeys.boundingBox"), run: toggleBBox },
  { key: "reset", label: () => t("hotkeys.resetView"), run: () => viewer.frameModel(true) },
  { key: "fullscreen", label: () => t("hotkeys.fullscreen"), run: () => void toggleFullscreen() },
  { key: "interface", label: () => t("hotkeys.interface"), run: toggleInterface },
  { key: "quit", label: () => t("hotkeys.quit"), run: () => void quitApp() },
];

/** Keys that never form a combination on their own. */
const MODIFIER_ONLY_KEYS = new Set([
  "Control", "Alt", "Shift", "Meta", "AltGraph",
  "CapsLock", "NumLock", "ScrollLock", "ContextMenu",
]);

/** Human-readable names for bindable mouse buttons (MouseEvent.button). */
const MOUSE_BUTTON_NAMES = [
  "Mouse Left", "Mouse Middle", "Mouse Right", "Mouse Back", "Mouse Forward",
];

/** Canonical key label from the PHYSICAL key (e.code), not the character
 * (e.key): Russian and English layouts must produce the same combination -
 * this app is English-only by design. */
function keyLabel(e: KeyboardEvent): string {
  const letter = /^Key([A-Z])$/.exec(e.code);
  if (letter) return letter[1];
  const digit = /^Digit([0-9])$/.exec(e.code);
  if (digit) return digit[1];
  return e.key.length === 1 ? e.key.toUpperCase() : e.key;
}

/** Normalizes a keyboard event to the stored combo string, e.g. "Ctrl+O",
 * "G". Modifier order is fixed: Ctrl+Alt+Shift+Meta+Key. */
function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(keyLabel(e));
  return parts.join("+");
}

/** Same normalization for mouse buttons, e.g. "Mouse Right", "Ctrl+Mouse1". */
function comboFromMouseEvent(e: MouseEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Meta");
  parts.push(MOUSE_BUTTON_NAMES[e.button] ?? `Mouse ${e.button}`);
  return parts.join("+");
}

function comboLabel(combo: string): string {
  return combo || "-"; // "-" = unassigned (cleared because of a duplicate)
}

const hotkeysRows = document.getElementById("hotkeys-rows")!;

/** Non-null while a hotkey button waits for the user to press the new
 * combination; Escape cancels the capture. */
let hotkeyCapture: { key: HotkeyKey; btn: HTMLButtonElement } | null = null;

// While a modal dialog is open, everything outside it is inert: WebView2
// never delivers mouse presses made over the viewport. So during a capture
// the dialog is closed and a full-screen overlay shows instead - after
// that keys AND mouse buttons can be captured anywhere.
let captureDialogWasOpen = false;
const captureOverlay = document.createElement("div");
captureOverlay.id = "capture-overlay";
captureOverlay.hidden = true;
captureOverlay.innerHTML = `<div class="capture-box" id="capture-text"></div>`;
document.body.appendChild(captureOverlay);

function renderHotkeyRows(): void {
  hotkeysRows.replaceChildren();
  for (const action of HOTKEY_ACTIONS) {
    const row = document.createElement("div");
    row.className = "hotkey-row";
    const label = document.createElement("span");
    label.className = "hotkey-label";
    label.textContent = action.label();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "hotkey-btn";
    btn.textContent = comboLabel(settings.hotkeys[action.key]);
    btn.title = t("hotkeys.title");
    const startCapture = (): void => {
      // Cancel an ongoing capture without re-rendering: re-rendering would
      // detach this very button from the DOM before it starts capturing.
      if (hotkeyCapture) {
        hotkeyCapture.btn.classList.remove("capturing");
        hotkeyCapture.btn.textContent = comboLabel(settings.hotkeys[hotkeyCapture.key]);
        hotkeyCapture = null;
      }
      hotkeyCapture = { key: action.key, btn };
      btn.classList.add("capturing");
      btn.textContent = t("hotkeys.pressKey");
      // Un-modal the dialog for the capture (see captureOverlay above).
      if (settingsDialog.open) {
        captureDialogWasOpen = true;
        settingsDialog.close();
      }
      captureOverlay.querySelector("#capture-text")!.textContent = t("hotkeys.capture");
      captureOverlay.hidden = false;
    };
    // Capture starts on mousedown (a mouse press must be bindable, and the
    // starting click itself must not be swallowed). The click event is only
    // honored when keyboard-generated (e.detail === 0) so Enter/Space work.
    btn.addEventListener("mousedown", (e) => {
      e.preventDefault();
      e.stopPropagation(); // the window-level mousedown must not capture this press
      startCapture();
    });
    btn.addEventListener("click", (e) => {
      if (e.detail === 0) startCapture();
    });
    row.append(label, btn);
    hotkeysRows.appendChild(row);
  }
}

function endHotkeyCapture(): void {
  hotkeyCapture = null;
  captureOverlay.hidden = true;
  if (captureDialogWasOpen) {
    captureDialogWasOpen = false;
    settingsDialog.showModal();
  }
  renderHotkeyRows();
}

/** Stores `combo` for the action currently being captured, clearing any
 * other action that held the same combination. */
function assignHotkeyCombo(combo: string): void {
  const capture = hotkeyCapture;
  if (!capture) return;
  for (const other of HOTKEY_ACTIONS) {
    if (other.key !== capture.key && settings.hotkeys[other.key] === combo) {
      setSetting("hotkeys", other.key, "");
    }
  }
  setSetting("hotkeys", capture.key, combo);
}

function showSettings(): void {
  const launchMaximized = document.getElementById("set-launch-maximized") as HTMLInputElement;
  launchMaximized.checked = settings.window.launchMaximized;
  const alwaysOnTop = document.getElementById("set-always-on-top") as HTMLInputElement;
  alwaysOnTop.checked = settings.window.alwaysOnTop;
  renderHotkeyRows();
  void populateLanguages();
  settingsDialog.showModal();
}

// ---------- language ----------

const languageSelect = document.getElementById("set-language") as HTMLSelectElement;

async function populateLanguages(): Promise<void> {
  let names: string[] = [];
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      names = await invoke<string[]>("list_languages");
    } catch (err) {
      console.warn("Could not list languages", err);
    }
  }
  languageSelect.replaceChildren();
  for (const name of ["english", ...names.filter((n) => n !== "english")]) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    languageSelect.appendChild(option);
  }
  languageSelect.value = currentLanguage();
}

languageSelect.addEventListener("change", () => {
  setSetting("general", "language", languageSelect.value);
  void setLanguage(languageSelect.value).then(() => {
    menuBar.rebuild();
    renderHotkeyRows();
    refreshStatusIcons();
  });
});

// ---------- menu bar ----------

// Labels are getters so the language switch and hotkey edits show up on
// the next rebuild / open.
const menus: MenuDef[] = [
  {
    label: () => t("menu.file"),
    icon: "file",
    items: [
      { label: () => t("menu.open"), hint: () => settings.hotkeys.open, icon: "folder-arrow-right", action: openFileDialog },
      { label: () => t("menu.quit"), hint: () => settings.hotkeys.quit, icon: "logout", action: () => void quitApp() },
    ],
  },
  {
    label: () => t("menu.view"),
    icon: "image",
    items: [
      { label: () => t("menu.resetView"), hint: () => settings.hotkeys.reset, icon: "compass", action: () => viewer.frameModel(true) },
      { label: () => t("menu.orthographic"), hint: "Num 5", checked: () => viewer.orthographic, action: () => viewer.setOrthographic(!viewer.orthographic) },
      { separator: true },
      { label: () => t("menu.front"), hint: "Num 1", action: () => viewer.setViewPreset("front") },
      { label: () => t("menu.back"), hint: "Ctrl+Num 1", action: () => viewer.setViewPreset("back") },
      { label: () => t("menu.left"), hint: "Ctrl+Num 3", action: () => viewer.setViewPreset("left") },
      { label: () => t("menu.right"), hint: "Num 3", action: () => viewer.setViewPreset("right") },
      { label: () => t("menu.top"), hint: "Num 7", action: () => viewer.setViewPreset("top") },
      { label: () => t("menu.bottom"), hint: "Ctrl+Num 7", action: () => viewer.setViewPreset("bottom") },
      { separator: true },
      { label: () => t("menu.grid"), hint: () => settings.hotkeys.grid, checked: () => viewer.gridVisible, icon: "grid-3", action: toggleGrid },
      { label: () => t("menu.wireframe"), hint: () => settings.hotkeys.wireframe, checked: () => viewer.wireframeOn, icon: "hash", action: toggleWireframe },
      { label: () => t("menu.boundingBox"), hint: () => settings.hotkeys.boundingBox, checked: () => viewer.bboxVisible, icon: "square", action: toggleBBox },
      { label: () => t("menu.fullscreen"), hint: () => settings.hotkeys.fullscreen, checked: () => fullscreenOn, icon: "arrows-diagonal", action: () => void toggleFullscreen() },
      { label: () => t("menu.interface"), hint: () => settings.hotkeys.interface, checked: () => !uiHidden, icon: "monitor-screenshot", action: toggleInterface },
    ],
  },
  {
    label: () => t("menu.tools"),
    icon: "construction",
    items: [
      { label: () => t("menu.settings"), icon: "cog-loop", action: showSettings },
      { label: () => t("menu.plugins"), icon: "document-code", action: () => pluginsDialog.showModal() },
    ],
  },
  {
    label: () => t("menu.about"),
    icon: "question-circle",
    action: showAbout,
  },
];

const menuBar = createMenuBar(document.getElementById("menubar")!, menus);

// Initial status bar: View state icons and the app version.
refreshStatusIcons();
document.getElementById("status-version")!.textContent = `v${APP_VERSION}`;

document.getElementById("settings-close")!.addEventListener("click", () => settingsDialog.close());
document.getElementById("plugins-close")!.addEventListener("click", () => pluginsDialog.close());

document.getElementById("set-launch-maximized")!.addEventListener("change", (e) => {
  setSetting("window", "launchMaximized", (e.target as HTMLInputElement).checked);
});

document.getElementById("set-always-on-top")!.addEventListener("change", async (e) => {
  const on = (e.target as HTMLInputElement).checked;
  setSetting("window", "alwaysOnTop", on);
  // Apply immediately, not only on the next launch.
  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().setAlwaysOnTop(on);
    } catch (err) {
      console.warn("Could not toggle always on top", err);
    }
  }
});

// Status bar FPS, refreshed twice a second from the render loop counter.
const fpsEl = document.getElementById("status-fps")!;
setInterval(() => {
  fpsEl.textContent = `${viewer.fps} fps`;
}, 500);

document.getElementById("hotkeys-reset")!.addEventListener("click", () => {
  Object.assign(settings.hotkeys, structuredClone(DEFAULTS.hotkeys));
  saveSettingsSoon();
  renderHotkeyRows();
});

// ---------- about ----------

function showAbout(): void {
  document.getElementById("about-version")!.textContent = t("about.version", { version: APP_VERSION });
  aboutDialog.showModal();
}

document.getElementById("about-close")!.addEventListener("click", () => aboutDialog.close());

document.getElementById("about-link")!.addEventListener("click", async (e) => {
  e.preventDefault();
  if ("__TAURI_INTERNALS__" in window) {
    // Open in the system browser, not inside the webview.
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl("https://votekickpanda.com/").catch((err) => console.warn("Could not open the link", err));
  } else {
    window.open("https://votekickpanda.com/", "_blank");
  }
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
  closeDialogsForModelOpen();
  if (!isSupportedFile(file.name)) {
    setStatus(t("status.unsupported", { name: file.name }), true);
    return;
  }
  // Dropped files arrive alone; any stale sidecar texture base is invalid here.
  setResourceBase("");
  try {
    const buffer = await readFile(file, (p) => setLoading(true, t("status.loadingModel", { name: file.name }), p));
    await loadModel(buffer, file.name);
  } catch (err) {
    handleLoadError(err, file.name);
  }
}

/** Entry point for files opened through the OS (command line / Explorer). */
async function openPath(path: string): Promise<void> {
  closeDialogsForModelOpen();
  if (!isSupportedFile(path)) {
    setStatus(t("status.unsupported", { name: path }), true);
    return;
  }
  const name = basename(path);
  setLoading(true, t("status.loadingModel", { name }), 0);
  try {
    const res = await fetch(convertFileSrc(path));
    if (!res.ok) throw new Error(`Cannot read file (HTTP ${res.status})`);
    // Sidecar textures (FBX/OBJ) resolve relative to the model's folder,
    // so the base must be known before parsing starts.
    setResourceBase(convertFileSrc(dirname(path)));
    const buffer = await readBodyWithProgress(res, (p) =>
      setLoading(true, t("status.loadingModel", { name }), p),
    );
    await loadModel(buffer, name);
  } catch (err) {
    handleLoadError(err, name);
  }
}

/** Reads the response body chunk by chunk so huge files show real read
 * progress instead of a frozen bar; falls back to arrayBuffer() when
 * streaming is unavailable. */
async function readBodyWithProgress(
  res: Response,
  onProgress: (p: number) => void,
): Promise<ArrayBuffer> {
  const total = Number(res.headers.get("Content-Length") ?? 0);
  if (!res.body || !total) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress(received / total);
  }
  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.length;
  }
  return buffer.buffer;
}

async function loadModel(buffer: ArrayBuffer, name: string): Promise<void> {
  const seq = ++loadingSeq;
  // Parsing has no progress events; for very large files say so explicitly,
  // otherwise a long parse looks like a hang.
  const parsingText =
    buffer.byteLength > 50 * 1024 * 1024
      ? t("status.parsing", { name })
      : t("status.loadingModel", { name });
  setLoading(true, parsingText, 1);

  try {
    const result = await loadFromArrayBuffer(buffer, name);
    if (seq !== loadingSeq) return; // superseded by another open

    viewer.setModel(result.object);
    setStatus(
      t("status.info", {
        name,
        size: (buffer.byteLength / 1024 / 1024).toFixed(1),
        polys: countTriangles(result.object).toLocaleString("en-US"),
      }),
    );
    document.title = `${name} - ${APP_TITLE}`;
  } catch (err) {
    if (seq !== loadingSeq) return;
    handleLoadError(err, name);
  } finally {
    if (seq === loadingSeq) setLoading(false);
  }
}

/** Total triangles across every mesh in the loaded model. */
function countTriangles(root: THREE.Object3D): number {
  let tris = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!(mesh as unknown as { isMesh?: boolean }).isMesh || !mesh.geometry) return;
    const geometry = mesh.geometry as THREE.BufferGeometry;
    const index = geometry.getIndex();
    const position = geometry.getAttribute("position");
    const corners = index ? index.count : position ? position.count : 0;
    tris += Math.floor(corners / 3);
  });
  return tris;
}

function handleLoadError(err: unknown, name: string): void {
  viewer.clearModel();
  console.error(err);
  const message = err instanceof Error ? err.message : String(err);
  const line = `Failed: ${name} - ${message}`;
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
    // Re-inserting the spinner SVG replays its SMIL animation.
    loadingOverlay.querySelector<HTMLElement>("#loading-icon")!.innerHTML =
      iconSvg("downloading-loop");
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

// ---------- keyboard & mouse ----------

window.addEventListener("keydown", (e) => {
  // While a hotkey button is capturing, every key (except Escape) becomes
  // the new combination, and the global shortcuts stay silent. Escape ends
  // the capture without closing the Settings dialog, Backspace clears the
  // binding.
  if (hotkeyCapture) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === "Escape") {
      endHotkeyCapture();
      return;
    }
    if (e.key === "Backspace" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      setSetting("hotkeys", hotkeyCapture.key, "");
      endHotkeyCapture();
      return;
    }
    if (e.key !== "Escape" && !MODIFIER_ONLY_KEYS.has(e.key)) {
      assignHotkeyCombo(comboFromEvent(e));
      endHotkeyCapture();
    }
    return;
  }

  // Open dialogs swallow keys; Escape closes them natively.
  if (settingsDialog.open || pluginsDialog.open || aboutDialog.open) return;
  if (e.target instanceof HTMLInputElement) return;

  // Blender-style numpad view shortcuts, fixed (not editable): e.code is
  // used, so they work with NumLock on or off and in any layout.
  switch (e.code) {
    case "Numpad1":
      e.preventDefault();
      viewer.setViewPreset(e.ctrlKey ? "back" : "front");
      return;
    case "Numpad3":
      e.preventDefault();
      viewer.setViewPreset(e.ctrlKey ? "left" : "right");
      return;
    case "Numpad7":
      e.preventDefault();
      viewer.setViewPreset(e.ctrlKey ? "bottom" : "top");
      return;
    case "Numpad9":
      e.preventDefault();
      viewer.flipView();
      return;
    case "Numpad5":
      e.preventDefault();
      viewer.setOrthographic(!viewer.orthographic);
      return;
    case "Numpad4":
      e.preventDefault();
      viewer.orbitView(-5, 0);
      return;
    case "Numpad6":
      e.preventDefault();
      viewer.orbitView(5, 0);
      return;
    case "Numpad8":
      e.preventDefault();
      viewer.orbitView(0, 5);
      return;
    case "Numpad2":
      e.preventDefault();
      viewer.orbitView(0, -5);
      return;
    case "NumpadAdd":
      e.preventDefault();
      viewer.zoomView(0.8);
      return;
    case "NumpadSubtract":
      e.preventDefault();
      viewer.zoomView(1.25);
      return;
  }

  for (const action of HOTKEY_ACTIONS) {
    const combo = settings.hotkeys[action.key];
    if (combo && comboFromEvent(e) === combo) {
      e.preventDefault();
      action.run();
      // If a dropdown is open, its checkmarks must reflect the change.
      menuBar.refreshOpenMenu();
      return;
    }
  }
});

let mouseHotkeyConsumed = false;

window.addEventListener("mousedown", (e) => {
  // Mouse buttons are bindable too: while capturing, any press (with
  // modifiers, e.g. Ctrl+Mouse Right) becomes the new combination.
  if (hotkeyCapture) {
    e.preventDefault();
    e.stopPropagation();
    assignHotkeyCombo(comboFromMouseEvent(e));
    endHotkeyCapture();
    mouseHotkeyConsumed = true;
    return;
  }

  // Open dialogs and clicks on UI controls are UI actions, not hotkeys.
  if (settingsDialog.open || pluginsDialog.open || aboutDialog.open) return;
  const target = e.target as HTMLElement | null;
  if (
    target instanceof HTMLButtonElement ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLAnchorElement ||
    (target && target.closest("#menubar, .dialog-actions"))
  ) {
    return;
  }

  for (const action of HOTKEY_ACTIONS) {
    const combo = settings.hotkeys[action.key];
    if (combo && comboFromMouseEvent(e) === combo) {
      e.preventDefault();
      mouseHotkeyConsumed = true;
      action.run();
      menuBar.refreshOpenMenu();
      return;
    }
  }
});

// A mouse button used as a hotkey must not also trigger the context menu.
window.addEventListener("contextmenu", (e) => {
  if (hotkeyCapture || mouseHotkeyConsumed) {
    e.preventDefault();
    mouseHotkeyConsumed = false;
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

  // Ensure the translation template %APPDATA%\...\lang\english.json exists
  // (backend only writes it when missing). Translators copy, edit and
  // rename it; the result shows up in Settings > Language.
  try {
    await invoke("save_language_template", { json: englishTemplate() });
  } catch (err) {
    console.warn("Could not create the language template", err);
  }

  // A path given on first launch, before the frontend was listening.
  const initial = await invoke<string | null>("initial_file");
  if (initial) openPath(initial);

  // Files routed from a second app instance (single-instance plugin).
  await getCurrentWebview().listen<string>("open-file", (event) => openPath(event.payload));
}
