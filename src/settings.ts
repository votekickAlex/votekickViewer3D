// Settings persistence.
//
// Settings live in %APPDATA%\votekickViewer3D\cfg\settings.json as JSON with
// named keys (never a positional blob), so new menu entries / submenus can
// simply add keys. The backend (src-tauri/src/lib.rs) owns the location and
// safe writes; the frontend owns the schema, defaults and merging.
//
// Structure:
//   view:   { grid, wireframe }     — toolbar toggle states
//   window: { width, height }       — restored by the backend on startup

import { DEFAULTS } from "./settings-schema";

export type AppSettings = typeof DEFAULTS;

export const settings: AppSettings = structuredClone(DEFAULTS);

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

let invoke: Invoke | null = null;

/** Resolve the Tauri invoke function; null when running in a plain browser
 * (dev server) — settings then simply do not persist. */
async function resolveInvoke(): Promise<void> {
  if (invoke || !("__TAURI_INTERNALS__" in window)) return;
  const { invoke: tauriInvoke } = await import("@tauri-apps/api/core");
  invoke = tauriInvoke as Invoke;
}

/** Deep-merges saved JSON over the defaults section by section; unknown keys
 * from the file are ignored so an older version cannot import garbage. */
function applyLoaded(raw: unknown): void {
  if (typeof raw !== "object" || raw === null) return;
  const saved = raw as Record<string, Record<string, unknown>>;
  for (const section of Object.keys(DEFAULTS) as (keyof AppSettings)[]) {
    const incoming = saved[section as string];
    if (typeof incoming !== "object" || incoming === null) continue;
    const target = settings[section] as Record<string, unknown>;
    for (const key of Object.keys(target)) {
      const value = incoming[key];
      if (typeof value === typeof target[key]) target[key] = value;
    }
  }
}

/** Loads saved settings and merges them into `settings`. Safe to call once
 * at startup before anything reads the values. */
export async function loadSettings(): Promise<void> {
  await resolveInvoke();
  if (!invoke) return;
  try {
    const json = await invoke("load_settings");
    if (typeof json === "string" && json.length > 0) {
      applyLoaded(JSON.parse(json));
    }
  } catch (err) {
    console.warn("Settings load failed, using defaults", err);
  }
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;

/** Schedules a debounced save; multiple quick changes coalesce into one
 * write. */
export function saveSettingsSoon(): void {
  const inv = invoke;
  if (!inv) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    inv("save_settings", { json: JSON.stringify(settings, null, 2) }).catch((err) =>
      console.warn("Settings save failed", err),
    );
  }, 400);
}

/** Updates a single named key, e.g. setSetting("view", "grid", true). */
export function setSetting<K extends keyof AppSettings>(
  section: K,
  key: keyof AppSettings[K],
  value: AppSettings[K][keyof AppSettings[K]],
): void {
  const target = settings[section] as Record<string, unknown>;
  if (typeof value !== typeof target[key as string]) return;
  target[key as string] = value;
  saveSettingsSoon();
}
