// The single source of truth for which settings exist. Every entry here is
// persisted by name; adding a menu entry / submenu later means adding a key
// here and reading it where needed.

export const DEFAULTS = {
  view: {
    grid: true,
    wireframe: false,
    bbox: false,
    gridColor: "#b03a3a",
    wireframeColor: "#ffffff",
    bboxColor: "#4f9cf9",
  },
  window: {
    launchMaximized: false,
    alwaysOnTop: false,
    // Opt-in: when enabled, the fullscreen state is persisted on every
    // toggle and re-applied at startup (gated again by rememberFullscreen).
    rememberFullscreen: false,
    fullscreen: false,
  },
  general: {
    language: "english",
    recentColors: [] as string[],
  },
  hotkeys: {
    open: "O",
    grid: "G",
    wireframe: "W",
    reset: "R",
    fullscreen: "F",
    interface: "H",
    boundingBox: "B",
    quit: "Q",
  },
};
