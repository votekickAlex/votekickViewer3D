// Declarative menu bar with dropdowns and keyboard support.
//
// The structure lives in one place (main.ts builds MenuDefs), so adding
// submenus, entries or hotkeys later means adding data, not rewriting
// behavior. Labels, hints and checkmarks may be getters; they are
// re-evaluated every time a menu opens or is refreshed, so edited hotkeys
// and language switches show up immediately.

import { iconSvg } from "./icons";

export interface MenuItemDef {
  label?: string | (() => string);
  /** Right-aligned shortcut hint, e.g. "Ctrl+O" or a getter re-read on
   * every menu open (so edited hotkeys show up immediately). */
  hint?: string | (() => string);
  /** Show a checkmark in front of the item when it returns true. */
  checked?: () => boolean;
  /** Render a horizontal separator line instead of a button. */
  separator?: boolean;
  /** Name from the icon set (src/icons.ts), rendered before the label. */
  icon?: string;
  action?: () => void;
  /** Nested items: the row opens a submenu instead of running an action. */
  submenu?: MenuItemDef[] | (() => MenuItemDef[]);
}

export interface MenuDef {
  label: string | (() => string);
  /** Menu rows; a getter lets the set of rows depend on the loaded model. */
  items?: MenuItemDef[] | (() => MenuItemDef[]);
  /** When set, the top-level button runs this action directly and has no
   * dropdown (e.g. About). */
  action?: () => void;
  /** Icon for a direct-action top-level button (shown before the label). */
  icon?: string;
}

export function createMenuBar(
  container: HTMLElement,
  menus: MenuDef[],
): {
  /** Re-creates the top-level buttons (e.g. after a language switch). */
  rebuild: () => void;
  /** Re-evaluates the open dropdown's labels, hints and checkmarks (e.g.
   * after a hotkey toggled a state while the menu was open). */
  refreshOpenMenu: () => void;
} {
  let openButton: HTMLElement | null = null;
  let openDropdown: HTMLElement | null = null;
  let openDef: MenuDef | null = null;

  const text = (value: string | (() => string)): string =>
    typeof value === "function" ? value() : value;

  const closeAll = (): void => {
    openButton?.classList.remove("open");
    openDropdown?.remove();
    openButton = null;
    openDropdown = null;
    openDef = null;
  };

  const focusFirstItem = (): void => {
    openDropdown?.querySelector<HTMLButtonElement>(".menu-item")?.focus();
  };

  const openMenu = (button: HTMLElement, def: MenuDef): void => {
    closeAll();
    button.classList.add("open");
    openButton = button;
    openDef = def;
    const dropdown = buildDropdown(def);
    container.appendChild(dropdown);
    openDropdown = dropdown;
  };

  const buildDropdown = (def: MenuDef): HTMLElement => {
    const dropdown = document.createElement("div");
    dropdown.className = "menu-dropdown";
    const defItems = typeof def.items === "function" ? def.items() : (def.items ?? []);
    for (const item of defItems) {
      if (item.separator) {
        const sep = document.createElement("div");
        sep.className = "menu-separator";
        dropdown.appendChild(sep);
        continue;
      }
      const row = document.createElement("button");
      row.type = "button";
      row.className = "menu-item";
      row.tabIndex = -1;
      // Always present, so labels line up whether or not an item has a
      // checkmark.
      const mark = document.createElement("span");
      mark.className = "menu-check";
      mark.textContent = item.checked?.() ? "✓" : "";
      row.appendChild(mark);
      if (item.icon) {
        const icon = document.createElement("span");
        icon.className = "menu-item-icon";
        icon.innerHTML = iconSvg(item.icon);
        row.appendChild(icon);
      } else {
        // Invisible placeholder: labels line up in one column even for
        // items without an icon.
        const spacer = document.createElement("span");
        spacer.className = "menu-item-icon";
        row.appendChild(spacer);
      }
      const label = document.createElement("span");
      label.className = "menu-label";
      label.textContent = item.label ? text(item.label) : "";
      row.appendChild(label);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "menu-hint";
        hint.textContent = text(item.hint);
        row.appendChild(hint);
      }
      // A row with submenu opens a nested dropdown instead of an action.
      let sub: HTMLElement | null = null;
      if (item.submenu) {
        row.classList.add("has-submenu");
        const closeSub = (): void => {
          sub?.remove();
          sub = null;
          row.classList.remove("submenu-open");
        };
        const openSub = (): void => {
          if (sub) return;
          closeSub();
          // Close any sibling submenu before opening this one.
          dropdown.querySelectorAll(".has-submenu.submenu-open").forEach((r) => {
            r.classList.remove("submenu-open");
            if (r.nextElementSibling?.classList.contains("menu-subdropdown")) {
              r.nextElementSibling.remove();
            }
          });
          sub = buildDropdown({ label: "", items: item.submenu! });
          sub.classList.add("menu-subdropdown");
          row.insertAdjacentElement("afterend", sub);
          row.classList.add("submenu-open");
        };
        row.addEventListener("click", (e) => {
          e.stopPropagation();
          if (sub) closeSub(); else openSub();
        });
        row.addEventListener("mouseenter", openSub);
        // Rebuilt on every open; submenu removal is handled by closeSub on
        // the next mouseleave of the row or click elsewhere.
        row.addEventListener("mouseleave", () => {
          // Small deferral lets the pointer cross the gap to the submenu.
          window.setTimeout(() => {
            if (sub && !sub.matches(":hover") && !row.matches(":hover")) closeSub();
          }, 120);
        });
      }
      row.addEventListener("click", () => {
        if (!item.submenu) {
          closeAll();
          item.action?.();
        }
      });
      dropdown.appendChild(row);
    }
    // Keyboard navigation inside the open menu. Items have tabIndex -1 and
    // Tab/Arrows are routed manually.
    dropdown.addEventListener("keydown", (e) => {
      if (!openDropdown) return;
      const items = Array.from(dropdown.querySelectorAll<HTMLButtonElement>(".menu-item"));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const move = (delta: number): void => {
        e.preventDefault();
        items[(index + delta + items.length) % items.length]?.focus();
      };
      switch (e.key) {
        case "ArrowDown":
          if (index < 0) {
            e.preventDefault();
            items[0]?.focus();
          } else move(1);
          break;
        case "ArrowUp":
          if (index < 0) {
            e.preventDefault();
            items[items.length - 1]?.focus();
          } else move(-1);
          break;
        case "Tab":
          move(e.shiftKey ? -1 : 1);
          break;
        case "Enter":
        case " ":
          if (index >= 0) {
            e.preventDefault();
            e.stopPropagation();
            closeAll();
            // DOM rows skip separators; align by filtered definitions so
            // keyboard activation targets the same item the pointer sees.
            const rows = (typeof def.items === "function" ? def.items() : (def.items ?? []))
              .filter((item) => !item.separator);
            rows[index]?.action?.();
          }
          break;
        case "Escape": {
          e.preventDefault();
          closeAll();
          openButton?.focus();
          break;
        }
        case "ArrowLeft":
        case "ArrowRight": {
          // Deliberately inert inside the menu: these keys switch to the
          // previous / next model in the folder in the main window, and
          // must not do that while a menu is open either.
          e.preventDefault();
          e.stopPropagation();
          break;
        }
      }
    });
    return dropdown;
  };

  const build = (): void => {
    closeAll();
    container.replaceChildren();
    menus.forEach((def, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-top";
      if (def.icon) {
        const icon = document.createElement("span");
        icon.className = "menu-item-icon";
        icon.innerHTML = iconSvg(def.icon);
        button.appendChild(icon);
        const label = document.createElement("span");
        label.textContent = text(def.label);
        button.appendChild(label);
      } else {
        button.textContent = text(def.label);
      }
      button.dataset.index = String(index);

      if (def.action) {
        // Direct action button (e.g. About): no dropdown; click or
        // Enter/Space runs it immediately.
        const run = (): void => {
          closeAll();
          def.action?.();
        };
        button.addEventListener("click", run);
        button.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            run();
          }
        });
      } else {
        button.addEventListener("click", () => {
          if (openButton === button) closeAll();
          else openMenu(button, def);
        });
        // Standard menu behavior: moving the pointer to another menu while
        // one is open switches to it without clicking.
        button.addEventListener("mouseenter", () => {
          if (openButton && openButton !== button) openMenu(button, def);
        });
        // Keyboard: Enter/Space/ArrowDown opens the dropdown and moves focus
        // into its first item (plain Tab between top buttons stays native).
        button.addEventListener("keydown", (e) => {
          if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            openMenu(button, def);
            focusFirstItem();
          }
        });
      }

      container.appendChild(button);
    });
  };

  document.addEventListener("click", (e) => {
    const target = e.target as Node;
    if (!container.contains(target) && !(openDropdown && openDropdown.contains(target))) {
      closeAll();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
  window.addEventListener("blur", closeAll);

  build();

  const refreshOpenMenu = (): void => {
    if (!openButton || !openDef) return;
    const hadFocus = openDropdown?.contains(document.activeElement) ?? false;
    const dropdown = buildDropdown(openDef);
    openDropdown?.replaceWith(dropdown);
    openDropdown = dropdown;
    if (hadFocus) focusFirstItem();
  };

  return { rebuild: build, refreshOpenMenu };
}
