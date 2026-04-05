export interface MenuItem {
  label: string;
  action?: () => void;
  separator?: boolean;
  submenu?: MenuItem[];
  disabled?: boolean;
}

let activeMenu: HTMLDivElement | null = null;

export function showContextMenu(x: number, y: number, items: MenuItem[]): void {
  closeContextMenu();

  const menu = document.createElement("div");
  menu.className = "ctx-menu";

  for (const item of items) {
    if (item.separator) {
      const sep = document.createElement("div");
      sep.className = "ctx-menu-separator";
      menu.appendChild(sep);
      continue;
    }

    const el = document.createElement("div");
    el.className = `ctx-menu-item${item.disabled ? " disabled" : ""}`;
    el.textContent = item.label;

    if (item.submenu) {
      el.classList.add("has-submenu");
      const arrow = document.createElement("span");
      arrow.className = "ctx-menu-arrow";
      arrow.textContent = "\u25b8"; // ▸
      el.appendChild(arrow);

      const sub = document.createElement("div");
      sub.className = "ctx-menu-submenu";
      for (const subItem of item.submenu) {
        const subEl = document.createElement("div");
        subEl.className = "ctx-menu-item";
        subEl.textContent = subItem.label;
        if (subItem.action) {
          subEl.addEventListener("click", (e) => {
            e.stopPropagation();
            closeContextMenu();
            subItem.action!();
          });
        }
        sub.appendChild(subEl);
      }
      el.appendChild(sub);
    } else if (item.action && !item.disabled) {
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        closeContextMenu();
        item.action!();
      });
    }

    menu.appendChild(el);
  }

  // Position — keep within viewport
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  document.body.appendChild(menu);

  // Adjust if overflowing
  requestAnimationFrame(() => {
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth) {
      menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    }
    if (rect.bottom > window.innerHeight) {
      menu.style.top = `${window.innerHeight - rect.height - 4}px`;
    }
  });

  activeMenu = menu;

  // Close on click outside
  const closeHandler = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      closeContextMenu();
      document.removeEventListener("mousedown", closeHandler);
    }
  };
  setTimeout(() => document.addEventListener("mousedown", closeHandler), 0);
}

export function closeContextMenu(): void {
  if (activeMenu) {
    activeMenu.remove();
    activeMenu = null;
  }
}

/** Prompt user for text input via an inline input in the menu position */
export function promptInput(
  x: number,
  y: number,
  currentValue: string,
  onSubmit: (value: string) => void,
): void {
  closeContextMenu();

  const wrap = document.createElement("div");
  wrap.className = "ctx-menu ctx-input-wrap";
  wrap.style.left = `${x}px`;
  wrap.style.top = `${y}px`;

  const input = document.createElement("input");
  input.className = "ctx-input";
  input.type = "text";
  input.value = currentValue;
  wrap.appendChild(input);

  document.body.appendChild(wrap);

  input.focus();
  input.select();

  const submit = () => {
    const val = input.value.trim();
    wrap.remove();
    if (val && val !== currentValue) onSubmit(val);
  };

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      submit();
    }
    if (e.key === "Escape") {
      wrap.remove();
    }
  });

  input.addEventListener("blur", () => {
    setTimeout(() => wrap.remove(), 100);
  });
}
