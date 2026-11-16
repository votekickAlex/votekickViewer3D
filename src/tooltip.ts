// Custom tooltips.
//
// Native HTML title tooltips have a long fixed delay and an OS styled
// look. This module shows a small styled bubble after a short delay for
// every element that carries a title attribute (status icons, menus,
// buttons, hotkey rows...). The native tooltip is suppressed by stashing
// and removing the title attribute for the hovered element and
// restoring it when the pointer leaves.

const TOOLTIP_DELAY = 333;

let host: Element | null = null;
let stashedTitle = "";
let timer = 0;

const tip = document.createElement("div");
tip.id = "tooltip";
tip.hidden = true;
document.body.appendChild(tip);

function hide(): void {
  window.clearTimeout(timer);
  timer = 0;
  tip.hidden = true;
}

/** Puts the bubble right above the pointer, clamped to the window edges.
 * A modal <dialog> paints in the browser top layer above every fixed
 * element, so while the hover is inside an open dialog the bubble is
 * moved into that dialog to appear above it. */
function showAt(x: number, y: number): void {
  if (!host || !stashedTitle) return;
  const dialog = host.closest("dialog");
  if (dialog && dialog.open) {
    if (tip.parentElement !== dialog) dialog.appendChild(tip);
  } else if (tip.parentElement !== document.body) {
    document.body.appendChild(tip);
  }
  tip.textContent = stashedTitle;
  tip.hidden = false;
  const pad = 8;
  const rect = tip.getBoundingClientRect();
  let left = x - rect.width / 2;
  let top = y - rect.height - 10;
  left = Math.min(Math.max(pad, left), window.innerWidth - rect.width - pad);
  top = Math.min(Math.max(pad, top), window.innerHeight - rect.height - pad);
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/** Drops the current host, restoring its title attribute. */
function release(): void {
  hide();
  if (tip.parentElement !== document.body) document.body.appendChild(tip);
  if (host) {
    host.setAttribute("title", stashedTitle);
  }
  host = null;
  stashedTitle = "";
}

document.addEventListener("pointerover", (e) => {
  const target = (e.target as Element | null)?.closest?.("[title]");
  if (!target || target === tip) return;
  if (target === host) return; // moving between children of the same host
  release();
  host = target;
  stashedTitle = host.getAttribute("title") ?? "";
  if (!stashedTitle) {
    host = null;
    return;
  }
  // Removing the attribute keeps the native tooltip from appearing;
  // the stash brings it back once the pointer leaves.
  host.removeAttribute("title");
  const px = e.clientX;
  const py = e.clientY;
  timer = window.setTimeout(() => showAt(px, py), TOOLTIP_DELAY);
});

document.addEventListener("pointerout", (e) => {
  if (!host) return;
  const to = e.relatedTarget as Element | null;
  if (to && host.contains(to)) return; // still inside the same host
  release();
});

// Clicks and scrolls must not leave a stale bubble behind.
document.addEventListener("pointerdown", hide);
document.addEventListener("wheel", hide, { passive: true });
window.addEventListener("blur", hide);
