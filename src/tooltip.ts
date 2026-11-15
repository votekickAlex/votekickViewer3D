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

/** Puts the bubble near the pointer, clamped to the window edges. */
function showAt(x: number, y: number): void {
  if (!host || !stashedTitle) return;
  tip.textContent = stashedTitle;
  tip.hidden = false;
  const pad = 12;
  let left = x + 14;
  let top = y + 20;
  const rect = tip.getBoundingClientRect();
  if (left + rect.width + pad > window.innerWidth) {
    left = Math.max(pad, x - rect.width - 10);
  }
  if (top + rect.height + pad > window.innerHeight) {
    top = Math.max(pad, y - rect.height - 10);
  }
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

/** Drops the current host, restoring its title attribute. */
function release(): void {
  hide();
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
