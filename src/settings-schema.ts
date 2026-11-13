// The single source of truth for which settings exist. Every entry here is
// persisted by name; adding a menu entry / submenu later means adding a key
// here and reading it where needed.

export const DEFAULTS = {
  view: {
    grid: true,
    wireframe: false,
  },
  window: {
    width: 0,
    height: 0,
  },
};
