// Declarative menu bar.
//
// The structure lives in one place (main.ts builds MenuDefs), so adding
// submenus, entries or hotkeys later means adding data, not rewriting
// behavior. Checkmarks are functions evaluated every time a menu opens.

export interface MenuItemDef {
  label: string;
  /** Right-aligned shortcut hint, e.g. "Ctrl+O" or a getter re-read on
   * every menu open (so edited hotkeys show up immediately). */
  hint?: string | (() => string);
  /** Show a checkmark in front of the item when it returns true. */
  checked?: () => boolean;
  action?: () => void;
}

export interface MenuDef {
  label: string;
  items: MenuItemDef[];
}

export function createMenuBar(container: HTMLElement, menus: MenuDef[]): void {
  let openButton: HTMLElement | null = null;
  let openDropdown: HTMLElement | null = null;

  const closeAll = (): void => {
    openButton?.classList.remove("open");
    openDropdown?.remove();
    openButton = null;
    openDropdown = null;
  };

  const buildDropdown = (def: MenuDef): HTMLElement => {
    const dropdown = document.createElement("div");
    dropdown.className = "menu-dropdown";
    for (const item of def.items) {
      const row = document.createElement("button");
      row.className = "menu-item";
      if (item.checked) {
        const mark = document.createElement("span");
        mark.className = "menu-check";
        mark.textContent = item.checked() ? "✓" : "";
        row.appendChild(mark);
      }
      const label = document.createElement("span");
      label.className = "menu-label";
      label.textContent = item.label;
      row.appendChild(label);
      if (item.hint) {
        const hint = document.createElement("span");
        hint.className = "menu-hint";
        hint.textContent = typeof item.hint === "function" ? item.hint() : item.hint;
        row.appendChild(hint);
      }
      row.addEventListener("click", () => {
        closeAll();
        item.action?.();
      });
      dropdown.appendChild(row);
    }
    return dropdown;
  };

  const openMenu = (button: HTMLElement, def: MenuDef): void => {
    closeAll();
    button.classList.add("open");
    openButton = button;
    const dropdown = buildDropdown(def);
    container.appendChild(dropdown);
    openDropdown = dropdown;
  };

  menus.forEach((def, index) => {
    const button = document.createElement("button");
    button.className = "menu-top";
    button.textContent = def.label;
    button.addEventListener("click", () => {
      if (openButton === button) closeAll();
      else openMenu(button, def);
    });
    // Standard menu behavior: moving the pointer to another menu while one
    // is open switches to it without clicking.
    button.addEventListener("mouseenter", () => {
      if (openButton && openButton !== button) openMenu(button, def);
    });
    button.dataset.index = String(index);
    container.appendChild(button);
  });

  document.addEventListener("click", (e) => {
    if (!container.contains(e.target as Node) && !(openDropdown && openDropdown.contains(e.target as Node))) {
      closeAll();
    }
  });
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeAll();
  });
  window.addEventListener("blur", closeAll);
}
