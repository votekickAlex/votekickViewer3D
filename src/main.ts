import { convertFileSrc } from "@tauri-apps/api/core";
import { Viewer } from "./viewer";
import { isSupportedFile, loadFromArrayBuffer, setResourceBase, SUPPORTED_EXTENSIONS } from "./loader";
import { loadSettings, saveSettingsSoon, setSetting, settings, type AppSettings } from "./settings";
import { DEFAULTS } from "./settings-schema";
import { createMenuBar, type MenuDef } from "./menu";
import { currentLanguage, englishTemplate, setLanguage, t } from "./i18n";

const APP_TITLE = "!votekickViewer3D";

const viewport = document.getElementById("viewport")!;
const statusEl = document.getElementById("status")!;
const dropHint = document.getElementById("drop-hint")!;
const fileInput = document.getElementById("file-input") as HTMLInputElement;
// The OS dialog must only offer the formats the viewer can actually load.
fileInput.accept = SUPPORTED_EXTENSIONS.join(",");
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
// menu binds, so checkmarks reflect the loaded state. The saved language is
// applied before any t() call (menus, dialogs) is made.
await loadSettings();
viewer.setGridVisible(settings.view.grid);
viewer.setWireframe(settings.view.wireframe);
await setLanguage(settings.general.language);

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

// ---------- hotkeys (editable in the Settings dialog) ----------

type HotkeyKey = keyof AppSettings["hotkeys"];

/** The four bound actions, shared by the menu, the global key listener and
 * the Settings rows. */
const HOTKEY_ACTIONS: { key: HotkeyKey; label: () => string; run: () => void }[] = [
  { key: "open", label: () => t("hotkeys.open"), run: openFileDialog },
  { key: "grid", label: () => t("hotkeys.grid"), run: toggleGrid },
  { key: "wireframe", label: () => t("hotkeys.wireframe"), run: toggleWireframe },
  { key: "reset", label: () => t("hotkeys.resetView"), run: () => viewer.frameModel() },
];

/** Keys that never form a combination on their own. */
const MODIFIER_ONLY_KEYS = new Set([
  "Control", "Alt", "Shift", "Meta", "AltGraph",
  "CapsLock", "NumLock", "ScrollLock", "ContextMenu",
]);

/** Canonical key label from the PHYSICAL key (e.code), not the character
 * (e.key): Russian and English layouts must produce the same combination —
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

function comboLabel(combo: string): string {
  return combo || "—"; // "—" = unassigned (cleared because of a duplicate)
}

const hotkeysRows = document.getElementById("hotkeys-rows")!;

/** Non-null while a hotkey button waits for the user to press the new
 * combination; Escape cancels the capture. */
let hotkeyCapture: { key: HotkeyKey; btn: HTMLButtonElement } | null = null;

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
    btn.addEventListener("click", () => {
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
    });
    row.append(label, btn);
    hotkeysRows.appendChild(row);
  }
}

function endHotkeyCapture(): void {
  hotkeyCapture = null;
  renderHotkeyRows();
}

function showSettings(): void {
  const launchMaximized = document.getElementById("set-launch-maximized") as HTMLInputElement;
  launchMaximized.checked = settings.window.launchMaximized;
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
  });
});

// ---------- menu bar ----------

// Labels are getters so the language switch and hotkey edits show up on
// the next rebuild / open.
const menus: MenuDef[] = [
  {
    label: () => t("menu.file"),
    items: [{ label: () => t("menu.open"), hint: () => settings.hotkeys.open, action: openFileDialog }],
  },
  {
    label: () => t("menu.view"),
    items: [
      { label: () => t("menu.grid"), hint: () => settings.hotkeys.grid, checked: () => viewer.gridVisible, action: toggleGrid },
      { label: () => t("menu.wireframe"), hint: () => settings.hotkeys.wireframe, checked: () => viewer.wireframeOn, action: toggleWireframe },
      { label: () => t("menu.resetView"), hint: () => settings.hotkeys.reset, action: () => viewer.frameModel() },
    ],
  },
  {
    label: () => t("menu.tools"),
    items: [
      { label: () => t("menu.settings"), action: showSettings },
      { label: () => t("menu.plugins"), action: () => pluginsDialog.showModal() },
    ],
  },
];

const menuBar = createMenuBar(document.getElementById("menubar")!, menus);

document.getElementById("settings-close")!.addEventListener("click", () => settingsDialog.close());
document.getElementById("plugins-close")!.addEventListener("click", () => pluginsDialog.close());

document.getElementById("set-launch-maximized")!.addEventListener("change", (e) => {
  setSetting("window", "launchMaximized", (e.target as HTMLInputElement).checked);
});

document.getElementById("hotkeys-reset")!.addEventListener("click", () => {
  Object.assign(settings.hotkeys, structuredClone(DEFAULTS.hotkeys));
  saveSettingsSoon();
  renderHotkeyRows();
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
  // While a hotkey button is capturing, every key (except Escape) becomes
  // the new combination, and the global shortcuts stay silent. Escape ends
  // the capture without closing the Settings dialog.
  if (hotkeyCapture) {
    e.preventDefault();
    e.stopPropagation();
    if (e.key !== "Escape" && !MODIFIER_ONLY_KEYS.has(e.key)) {
      // Backspace (without modifiers) clears the binding entirely.
      if (e.key === "Backspace" && !e.ctrlKey && !e.altKey && !e.metaKey) {
        setSetting("hotkeys", hotkeyCapture.key, "");
        endHotkeyCapture();
        return;
      }
      const combo = comboFromEvent(e);
      // A combination can only be bound once: clear duplicates first.
      for (const other of HOTKEY_ACTIONS) {
        if (other.key !== hotkeyCapture.key && settings.hotkeys[other.key] === combo) {
          setSetting("hotkeys", other.key, "");
        }
      }
      setSetting("hotkeys", hotkeyCapture.key, combo);
    }
    endHotkeyCapture();
    return;
  }

  // Open dialogs swallow keys; Escape closes them natively.
  if (settingsDialog.open || pluginsDialog.open) return;
  if (e.target instanceof HTMLInputElement) return;

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
