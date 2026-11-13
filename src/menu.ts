// Declarative menu bar with dropdowns and keyboard support.
//
// The structure lives in one place (main.ts builds MenuDefs), so adding
// submenus, entries or hotkeys later means adding data, not rewriting
// behavior. Labels, hints and checkmarks may be getters; they are
// re-evaluated every time a menu opens or is refreshed, so edited hotkeys
// and language switches show up immediately.

export interface MenuItemDef {
  label: string | (() => string);
  /** Right-aligned shortcut hint, e.g. "Ctrl+O" or a getter re-read on
   * every menu open (so edited hotkeys show up immediately). */
  hint?: string | (() => string);
  /** Show a checkmark in front of the item when it returns true. */
  checked?: () => boolean;
  action?: () => void;
}

export interface MenuDef {
  label: string | (() => string);
  items?: MenuItemDef[];
  /** When set, the top-level button runs this action directly and has no
   * dropdown (e.g. About). */
  action?: () => void;
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
    for (const item of def.items ?? []) {
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
      const label = document.createElement("span");
      label.className = "menu-label";
      label.textContent = text(item.label);
      row.appendChild(label);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "menu-hint";
        hint.textContent = text(item.hint);
        row.appendChild(hint);
      }
      row.addEventListener("click", () => {
        closeAll();
        item.action?.();
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
            closeAll();
            def.items?.[index]?.action?.();
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
          e.preventDefault();
          const current = openButton;
          if (!current) break;
          const tops = Array.from(container.querySelectorAll<HTMLElement>(".menu-top"));
          const at = tops.indexOf(current);
          closeAll();
          const next = tops[(at + (e.key === "ArrowRight" ? 1 : -1) + tops.length) % tops.length];
          if (next) {
            openMenu(next, menus[Number(next.dataset.index)]);
            focusFirstItem();
          }
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
      button.textContent = text(def.label);
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
