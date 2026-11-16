// ShareX style color picker dialog.
//
// Opened from Settings > Colors. Contains a saturation/value gradient
// square, a hue strip, an alpha strip, RGB and alpha numeric fields, a hex
// field, recent colors (persisted) and a fixed standard palette. The dialog
// resolves with an "#rrggbbaa" string (alpha omitted when opaque) or null
// on cancel.

const STANDARD_COLORS = [
  "#ff0000", "#ff8000", "#ffff00", "#00ff00", "#00ffff", "#0080ff",
  "#0000ff", "#8000ff", "#ff00ff", "#ff0080",
  "#000000", "#404040", "#808080", "#c0c0c0", "#ffffff",
];

const MAX_RECENT = 12;

interface HSVA {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
  a: number; // 0..1
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const hh = (h % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 1) [r, g, b] = [c, x, 0];
  else if (hh < 2) [r, g, b] = [x, c, 0];
  else if (hh < 3) [r, g, b] = [0, c, x];
  else if (hh < 4) [r, g, b] = [0, x, c];
  else if (hh < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  return [r + m, g + m, b + m];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

function toHexPair(value: number): string {
  return Math.round(value).toString(16).padStart(2, "0").toUpperCase();
}

/** Formats as "#rrggbb" (opaque) or "#rrggbbaa". */
function hsvaToHex(c: HSVA): string {
  const [r, g, b] = hsvToRgb(c.h, c.s, c.v);
  const hex = `#${toHexPair(r * 255)}${toHexPair(g * 255)}${toHexPair(b * 255)}`;
  return c.a < 1 ? `${hex}${toHexPair(c.a * 255)}` : hex;
}

function parseHex(hex: string): HSVA | null {
  const text = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(text)) return null;
  const r = parseInt(text.slice(0, 2), 16) / 255;
  const g = parseInt(text.slice(2, 4), 16) / 255;
  const b = parseInt(text.slice(4, 6), 16) / 255;
  const a = text.length >= 8 ? parseInt(text.slice(6, 8), 16) / 255 : 1;
  const [h, s, v] = rgbToHsv(r, g, b);
  return { h, s, v, a };
}

function el<T extends HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

const dialog = el<HTMLDialogElement>("color-dialog");
const sv = el<HTMLDivElement>("cp-sv");
const svCursor = el<HTMLDivElement>("cp-sv-cursor");
const hue = el<HTMLDivElement>("cp-hue");
const hueCursor = el<HTMLDivElement>("cp-hue-cursor");
const alpha = el<HTMLDivElement>("cp-alpha");
const alphaCursor = el<HTMLDivElement>("cp-alpha-cursor");
const inputs = {
  r: el<HTMLInputElement>("cp-r"),
  g: el<HTMLInputElement>("cp-g"),
  b: el<HTMLInputElement>("cp-b"),
  a: el<HTMLInputElement>("cp-a"),
  hex: el<HTMLInputElement>("cp-hex"),
};
const newSwatch = el<HTMLDivElement>("cp-new");
const currentSwatch = el<HTMLDivElement>("cp-current");
const recentRow = el<HTMLDivElement>("cp-recent");
const standardRow = el<HTMLDivElement>("cp-standard");

let state: HSVA = { h: 0, s: 1, v: 1, a: 1 };
let done: ((hex: string | null) => void) | null = null;
let recentColors: string[] = [];
let opened = false;

/** Renders the current state into every control. */
function render(): void {
  const [r, g, b] = hsvToRgb(state.h, state.s, state.v);
  const hex = hsvaToHex(state);
  const base = `hsl(${state.h} 100% 50%)`;
  sv.style.backgroundImage =
    `linear-gradient(to top, #000, rgba(0,0,0,0)), ` +
    `linear-gradient(to right, #fff, rgba(255,255,255,0)), ${base}`;
  svCursor.style.left = `${state.s * 100}%`;
  svCursor.style.top = `${(1 - state.v) * 100}%`;
  hueCursor.style.top = `${(state.h / 360) * 100}%`;
  alpha.style.backgroundImage =
    `linear-gradient(to right, transparent, ${base}), repeating-conic-gradient(#666 0% 25%, #999 0% 50%)`;
  alpha.style.backgroundSize = "auto, 12px 12px";
  alphaCursor.style.left = `${state.a * 100}%`;
  inputs.r.value = String(Math.round(r * 255));
  inputs.g.value = String(Math.round(g * 255));
  inputs.b.value = String(Math.round(b * 255));
  inputs.a.value = String(Math.round(state.a * 255));
  inputs.hex.value = hex.slice(0, 7);
  newSwatch.style.background = hex;
}

/** Applies a hex string from any source (palette, eyedropper, hex field). */
function applyHex(hex: string): void {
  const parsed = parseHex(hex);
  if (!parsed) return;
  state = parsed;
  render();
}

function applyRgbField(): void {
  const r = clamp(Number(inputs.r.value) || 0, 0, 255) / 255;
  const g = clamp(Number(inputs.g.value) || 0, 0, 255) / 255;
  const b = clamp(Number(inputs.b.value) || 0, 0, 255) / 255;
  const [h, s, v] = rgbToHsv(r, g, b);
  // Grays (s or v 0) lose their hue; keep the current one then.
  state = { h: s === 0 || v === 0 ? state.h : h, s, v, a: state.a };
  render();
}

function applyAlphaField(): void {
  state.a = clamp((Number(inputs.a.value) || 0) / 255, 0, 1);
  render();
}

/** Strips an alpha channel for the recent colors row. */
function opaqueHex(hex: string): string {
  return hex.slice(0, 7);
}

function buildRow(row: HTMLElement, colors: string[]): void {
  row.replaceChildren();
  for (const color of colors) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "cp-chip";
    button.style.background = color;
    button.title = color;
    button.addEventListener("click", () => applyHex(color));
    row.appendChild(button);
  }
}

function bindOnce(): void {
  // Pointer drags on the gradient strips.
  const drag = (strip: HTMLElement, onPoint: (x: number, y: number, rect: DOMRect) => void) => {
    strip.addEventListener("pointerdown", (e) => {
      strip.setPointerCapture(e.pointerId);
      const rect = strip.getBoundingClientRect();
      onPoint(e.clientX, e.clientY, rect);
    });
    strip.addEventListener("pointermove", (e) => {
      if (!strip.hasPointerCapture(e.pointerId)) return;
      const rect = strip.getBoundingClientRect();
      onPoint(e.clientX, e.clientY, rect);
    });
  };
  drag(sv, (x, y, rect) => {
    state.s = clamp((x - rect.left) / rect.width, 0, 1);
    state.v = 1 - clamp((y - rect.top) / rect.height, 0, 1);
    render();
  });
  drag(hue, (_x, y, rect) => {
    state.h = clamp((y - rect.top) / rect.height, 0, 1) * 360;
    render();
  });
  drag(alpha, (x, _y, rect) => {
    state.a = clamp((x - rect.left) / rect.width, 0, 1);
    render();
  });

  for (const key of ["r", "g", "b"] as const) {
    inputs[key].addEventListener("input", applyRgbField);
  }
  inputs.a.addEventListener("input", applyAlphaField);
  inputs.hex.addEventListener("change", () => applyHex(inputs.hex.value));

  el<HTMLButtonElement>("cp-ok").addEventListener("click", finishOk);
  el<HTMLButtonElement>("cp-cancel").addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    if (done) done(null);
    done = null;
    opened = false;
  });
}

function finishOk(): void {
  const hex = hsvaToHex(state);
  recentColors = [
    opaqueHex(hex),
    ...recentColors.filter((c) => c.toLowerCase() !== opaqueHex(hex).toLowerCase()),
  ].slice(0, MAX_RECENT);
  buildRow(recentRow, recentColors);
  const resolve = done;
  done = null;
  opened = false;
  dialog.close();
  if (resolve) resolve(hex);
}

/** Opens the picker; resolves with the chosen "#rrggbbaa" string or null
 * when cancelled. `recent` seeds the recent colors row. */
export function openColorPicker(initial: string, recent: string[]): Promise<string | null> {
  if (!opened) {
    bindOnce();
    opened = true;
  }
  recentColors = recent.map(opaqueHex);
  currentSwatch.style.background = initial;
  applyHex(initial);
  buildRow(recentRow, recentColors);
  buildRow(standardRow, STANDARD_COLORS);
  dialog.showModal();
  return new Promise((resolve) => {
    done = resolve;
  });
}
