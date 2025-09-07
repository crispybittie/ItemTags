import { Plugin, SettingsTypes } from "@highlite/core";
import styles from "../resources/css/base.css";

/**
 * ItemIdentifier Plugin
 * --------------------------
 * Adds a small bottom-left "tag" overlay to inventory/bank/shop items for
 * categories Roots, Potions, Logs, Scrolls. Tags are derived from item names.
 *
 * Event strategy:
 *  - Prefer gamehooks-driven updates via inventory/bank/shop change signals.
 *  - Fallback to a MutationObserver if no reliable hook is available.
 *
 * Styling mirrors `.hs-inventory-item__amount`, but anchors at the bottom.
 * The tag is attached to the *same parent* as the amount badge when present
 * to avoid conflicts with plugins that reorder items.
 */
export default class ItemIdentifier extends Plugin {
  pluginName = "Item Identifier";
  author = "Elliott";

  private styleEl: HTMLStyleElement | null = null;
  private observer: MutationObserver | null = null;
  private rafId: number | null = null;
  private unsubscribers: Array<() => void> = [];
  private started = false;

  constructor() {
    super();

    this.settings.enable = {
      text: "Enable",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => {
        if (this.settings.enable.value) this.start(); else this.stop();
      },
    } as any;

    this.settings.showRoots = {
      text: "Show Root tags",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;

    this.settings.showPotions = {
      text: "Show Potion tags",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;

    this.settings.showLogs = {
      text: "Show Log tags",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;

    this.settings.showScrolls = {
      text: "Show Scroll tags",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;
  }

  init(): void {
    this.log("ItemIdentifier initialised");
  }

  start() {
    if (!this.settings.enable.value) return;
    if (this.started) {
      this.stop();
    }
    this.started = true;
    this.log("ItemIdentifier starting");
    this.injectStyle();
    this.attachGameHookSubscriptions();
    this.attachObserverFallback();
    this.rescanSoon();
  }

  stop() {
    this.started = false;
    this.log("ItemIdentifier stopping");
    // Detach subs
    for (const u of this.unsubscribers.splice(0)) {
      try { u(); } catch {}
    }

    // Detach observer
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    // Cancel debounced scans
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    // Remove injected style
    if (this.styleEl) {
      this.styleEl.remove();
      this.styleEl = null;
    }

    // Remove badges
    document
      .querySelectorAll(".hs-inventory-item__tag[data-hs-tag-overlay]")
      .forEach((el) => el.remove());
  }

  // ---------- Styling ----------
  private injectStyle() {
    if (this.styleEl) this.styleEl.remove();
    this.styleEl = document.createElement("style");
    this.styleEl.setAttribute("data-item-identifier-style", "true");
    this.styleEl.textContent = styles;
    document.head.appendChild(this.styleEl);
  }

  // ---------- Event wiring ----------
  private attachGameHookSubscriptions() {
    const em = (this as any).gameHooks?.EntityManager?.Instance;
    if (!em) return;

    const mainPlayer = em?.MainPlayer;

    // Inventory changes (try multiple shapes inspired by examples)
    const inv = mainPlayer?.Inventory;
    if (inv?.OnInventoryChangeListener?.add) {
      const cb = this.rescanSoon.bind(this);
      inv.OnInventoryChangeListener.add(cb);
      this.unsubscribers.push(() => inv.OnInventoryChangeListener?.remove?.(cb));
    } else {
      this.trySubscribe(inv, this.rescanSoon.bind(this));
    }

    // Bank items changes
    const bankStorage = (mainPlayer as any)?.BankStorageItems;
    if (bankStorage?.OnInventoryChangeListener?.add) {
      const cb = this.rescanSoon.bind(this);
      bankStorage.OnInventoryChangeListener.add(cb);
      this.unsubscribers.push(() => bankStorage.OnInventoryChangeListener?.remove?.(cb));
    }
    if (bankStorage?.OnReorganizedItemsListener?.add) {
      const cb2 = this.rescanSoon.bind(this);
      bankStorage.OnReorganizedItemsListener.add(cb2);
      this.unsubscribers.push(() => bankStorage.OnReorganizedItemsListener?.remove?.(cb2));
    }
    // Fallback to older/internal bank items containers
    this.trySubscribe(mainPlayer?._bankItems, this.rescanSoon.bind(this));

    // Shop items (when open)
    this.trySubscribe(mainPlayer?._currentState?._shopItems, this.rescanSoon.bind(this));
  }

  /** Try common subscription shapes without throwing if absent. */
  private trySubscribe(obj: any, cb: () => void) {
    if (!obj) return;

    // 1) Observable-style: obj.OnChange.Subscribe(fn) -> token ; Unsubscribe(token)
    if (obj.OnChange?.Subscribe) {
      const token = obj.OnChange.Subscribe(cb);
      this.unsubscribers.push(() => obj.OnChange?.Unsubscribe?.(token));
      return;
    }
    if (obj.OnItemsChanged?.Subscribe) {
      const token = obj.OnItemsChanged.Subscribe(cb);
      this.unsubscribers.push(() => obj.OnItemsChanged?.Unsubscribe?.(token));
      return;
    }

    // 2) EventEmitter: obj.on('change', fn) / obj.off('change', fn)
    if (typeof obj.on === 'function' && typeof obj.off === 'function') {
      obj.on('change', cb);
      this.unsubscribers.push(() => obj.off('change', cb));
      return;
    }

    // 3) addEventListener style
    if (typeof obj.addEventListener === 'function' && typeof obj.removeEventListener === 'function') {
      obj.addEventListener('change', cb);
      this.unsubscribers.push(() => obj.removeEventListener('change', cb));
      return;
    }
  }

  /** DOM fallback if hooks are missing */
  private attachObserverFallback() {
    const root = document.querySelector(
      ".hs-item-table--inventory, .hs-item-table--bank, .hs-item-table--shop"
    ) || document.body;

    this.observer = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'childList' && (m.addedNodes.length || m.removedNodes.length)) {
          this.rescanSoon();
          return;
        }
        if (m.type === 'attributes' && /data-slot|class|title|data-item-name/.test(m.attributeName || '')) {
          this.rescanSoon();
          return;
        }
      }
    });

    this.observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-slot", "class", "title", "data-item-name"],
    });
  }

  private rescanSoon() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = requestAnimationFrame(() => this.rescan());
  }

  // ---------- Core logic ----------
  private rescan() {
    if (!this.settings.enable.value) return;

    const selectors = [
      ".hs-item-table--inventory .hs-item-table__cell",
      ".hs-item-table--bank .hs-item-table__cell",
      ".hs-item-table--shop .hs-item-table__cell",
    ];
    document
      .querySelectorAll<HTMLElement>(selectors.join(","))
      .forEach((el) => this.applyTag(el));
  }

  private applyTag(cell: HTMLElement) {
    try {
      const slotIdStr = cell.getAttribute("data-slot");
      if (!slotIdStr) return this.removeBadge(cell);
      const slotId = parseInt(slotIdStr, 10);

      const item = this.resolveItemFromCell(cell, slotId);
      if (!item) return this.removeBadge(cell);

      const name = this.resolveItemName(item);
      if (!name) return this.removeBadge(cell);

      const tag = this.deriveTag(name);
      if (!tag) return this.removeBadge(cell);

      const host = this.getTagHost(cell);
      if (!host) return;

      let badge = host.querySelector<HTMLElement>(":scope > .hs-inventory-item__tag[data-hs-tag-overlay]");
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "hs-inventory-item__tag";
        badge.setAttribute("data-hs-tag-overlay", "true");
        host.appendChild(badge);
      }
      if (badge.textContent !== tag) badge.textContent = tag;
    } catch (e) {
      // Silent fail; never disrupt game loop
    }
  }

  private removeBadge(cell: HTMLElement) {
    const host = this.getTagHost(cell);
    const badge = host?.querySelector<HTMLElement>(":scope > .hs-inventory-item__tag[data-hs-tag-overlay]");
    if (badge) badge.remove();
  }

  /** Prefer the same parent as amount badge to coexist with other plugins */
  private getTagHost(cell: HTMLElement): HTMLElement | null {
    const amount = cell.querySelector(".hs-inventory-item__amount");
    if (amount && amount.parentElement) return amount.parentElement as HTMLElement;
    return cell; // fallback
  }

  private resolveItemFromCell(cell: HTMLElement, slotId: number): any | null {
    const em = (this as any).gameHooks?.EntityManager?.Instance;
    if (!em) return null;

    if (cell.closest(".hs-item-table--inventory")) {
      return em.MainPlayer?.Inventory?.Items?.[slotId] ?? null;
    }
    if (cell.closest(".hs-item-table--bank")) {
      return em.MainPlayer?._bankItems?._items?.[slotId] ?? null;
    }
    if (cell.closest(".hs-item-table--shop")) {
      return em.MainPlayer?._currentState?._shopItems?._items?.[slotId] ?? null;
    }
    return null;
  }

  private resolveItemName(item: any): string | null {
    // Prefer attached definition on item
    const def = item?._def || item?._itemDefinition || (item as any)?.def || null;
    let raw = (def && (def._nameCapitalized || def._name)) || (item as any)._nameCapitalized || (item as any)._name || null;

    // Fallback to global ItemDefinitionManager by id if available
    if (!raw && (item?._id != null)) {
      try {
        const gh: any = (document as any).highlite?.gameHooks;
        const itemDefMgr = gh?.ItemDefinitionManager;
        const map = itemDefMgr?._itemDefMap;
        const def2 = map?.get ? map.get(item._id) : gh?.ItemDefMap?.ItemDefMap?.get?.(item._id);
        raw = def2?._nameCapitalized || def2?._name || null;
      } catch {}
    }
    if (typeof raw === "string") return raw.trim();
    return null;
  }

  private deriveTag(name: string): string | null {
    const n = name.trim();

    const rootMatch = /^(.*?)\s+root(s)?$/i.exec(n);
    if (rootMatch && this.settings.showRoots.value) {
      const prefix = rootMatch[1].trim();
      return prefix ? prefix.slice(0, 3) : "Reg";
    }

    const potionMatch = /^potion of\s+(.+?)\s*\((\d+)\)$/i.exec(n);
    if (potionMatch && this.settings.showPotions.value) {
      const type = potionMatch[1].trim();
      const doses = potionMatch[2];
      return `${type.slice(0, 3)} (${doses})`;
    }

    const logsMatch = /^(.*?)\s*logs$/i.exec(n);
    if (logsMatch && this.settings.showLogs.value) {
      const prefix = logsMatch[1].trim();
      return prefix ? prefix.slice(0, 3) : "Reg";
    }

    const scrollsMatch = /^(.*?)\s*scrolls$/i.exec(n);
    if (scrollsMatch && this.settings.showScrolls.value) {
      const prefix = scrollsMatch[1].trim();
      return prefix ? prefix.slice(0, 3) : "Reg";
    }

    return null;
  }
}
