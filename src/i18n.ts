// Minimal i18n.
//
// English is built in (the ENGLISH table below) and is always the fallback.
// A translated copy is a plain JSON file with the same flat "key": "text"
// pairs, placed in %APPDATA%\votekickViewer3D\lang\<name>.json (the Settings
// dialog can export the built-in english.json as the starting template).
// Missing keys in a translation simply fall back to English, so a partially
// translated file never breaks the UI.
//
// Dynamic values use {name}-style placeholders, filled by t().

export const ENGLISH: Record<string, string> = {
  "menu.file": "File",
  "menu.view": "View",
  "menu.tools": "Tools",
  "menu.open": "Open…",
  "menu.grid": "Grid",
  "menu.wireframe": "Wireframe",
  "menu.resetView": "Reset view",
  "menu.settings": "Settings…",
  "menu.plugins": "Plugins…",
  "menu.fullscreen": "Full screen",
  "menu.interface": "Interface",
  "menu.about": "About",

  "about.version": "Version {version}",

  "status.noModel": "No model loaded",
  "status.loading": "Loading…",
  "status.loadingModel": "Loading {name}…",
  "status.unsupported": "Unsupported file: {name}",

  "drop.hint": "Drop model file here",

  "settings.title": "Settings",
  "settings.launchMaximized": "Launch maximized window",
  "settings.hotkeys": "Hotkeys",
  "settings.language": "Language",
  "settings.languageHint":
    "Custom language: english.json is created in the lang folder on first launch. Copy it, translate it, rename it to your language and put it back — it appears in this list.",

  "hotkeys.open": "Open file",
  "hotkeys.grid": "Grid",
  "hotkeys.wireframe": "Wireframe",
  "hotkeys.resetView": "Reset view",
  "hotkeys.fullscreen": "Full screen",
  "hotkeys.interface": "Interface",
  "hotkeys.pressKey": "Press a key…",
  "hotkeys.title": "Click, then press the new key combination (Esc cancels)",
  "hotkeys.reset": "Reset hotkeys",

  "plugins.title": "Plugins",
  "plugins.todo": "TODO: custom user plugins are planned for a future version.",

  "dialog.close": "Close",
  "dialog.ok": "OK",
};

let current = "english";
let dict: Record<string, string> = ENGLISH;

export function currentLanguage(): string {
  return current;
}

export function t(key: string, vars?: Record<string, string | number>): string {
  let text = dict[key] ?? ENGLISH[key] ?? key;
  if (vars) {
    for (const [name, value] of Object.entries(vars)) {
      text = text.split(`{${name}}`).join(String(value));
    }
  }
  return text;
}

/** The built-in dictionary as a JSON template for translators. */
export function englishTemplate(): string {
  return JSON.stringify(ENGLISH, null, 2);
}

/** Re-renders every element carrying a data-i18n / data-i18n-title
 * attribute (static HTML: dialogs, status bar, drop hint). Menus and
 * dynamic status text re-render separately. */
export function applyI18n(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  document.querySelectorAll<HTMLElement>("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
  });
}

/** Switches the active language. "english" uses the built-in dictionary;
 * any other name loads %APPDATA%\votekickViewer3D\lang\<name>.json through
 * the backend (missing file or garbage JSON falls back to English). */
export async function setLanguage(name: string): Promise<void> {
  current = name;
  dict = ENGLISH;
  if (name !== "english" && "__TAURI_INTERNALS__" in window) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const json = await invoke<string | null>("load_language", { name });
      if (json) {
        const parsed: unknown = JSON.parse(json);
        if (typeof parsed === "object" && parsed !== null) {
          dict = { ...ENGLISH };
          for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof value === "string") dict[key] = value;
          }
        }
      }
    } catch (err) {
      console.warn(`Language "${name}" load failed, using English`, err);
    }
  }
  applyI18n();
}
