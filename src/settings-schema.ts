// The single source of truth for which settings exist. Every entry here is
// persisted by name; adding a menu entry / submenu later means adding a key
// here and reading it where needed.

export const DEFAULTS = {
  view: {
    grid: true,
    wireframe: false,
    bbox: false,
    // World axes lines in the viewport; toggle from the status bar,
    // the View menu, Settings or the A hotkey.
    axes: true,
    gridColor: "#404040",
    wireframeColor: "#80808080",
    bboxColor: "#0080FF",
    // Viewport background behind the model; matches the old fixed color.
    backgroundColor: "#1c1f24",
    // Axis line opacity in percent (Settings > Colors slider).
    axesOpacity: 100,
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
    // Measurement readout unit: auto picks by magnitude assuming the
    // world unit is a meter; fixed modes for files authored in other
    // units (OBJ/STL/FBX carry no reliable unit).
    units: "auto",
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
    units: "M",
    playPause: "Space",
    axes: "A",
  },
};
