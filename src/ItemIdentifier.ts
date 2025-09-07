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

    this.settings.showBows = {
      text: "Show Bow tags",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;

    this.settings.showJewelry = {
      text: "Show Jewelry tags",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;

    this.settings.showGems = {
      text: "Show Gem tags",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;

    this.settings.ignoreMagicalScrolls = {
      text: "Ignore Magical Scrolls",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;

    this.settings.showOres = {
      text: "Show Ore tags",
      type: SettingsTypes.checkbox,
      value: true,
      callback: () => this.rescanSoon(),
    } as any;

    this.settings.showBars = {
      text: "Show Bar tags",
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
        badge.className = "hs-inventory-item__tag hs-small-text hs-normal-weight-text";
        badge.setAttribute("data-hs-tag-overlay", "true");
        // Ensure host can position absolutely-positioned children
        try {
          const cs = getComputedStyle(host);
          if (cs.position === "static") {
            (host as HTMLElement).style.position = "relative";
          }
        } catch {}
        host.appendChild(badge);
      }
      // Mirror amount typography so font size and face match without copying its position
      this.syncBadgeTypography(host, badge);
      const displayTag = this.formatTag(tag);
      if (badge.textContent !== displayTag) badge.textContent = displayTag;
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
    const item = cell.querySelector(".hs-inventory-item") as HTMLElement | null;
    if (item) return item;
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

    // Manual overrides by category
    const MANUAL: Record<string, Record<string, string>> = {
      logs: { reg: 'Norm', lucky: 'Luck', pine: 'Pine', deadwood: 'Dead', cherry: 'Cher', palm: 'Palm' },
      // Scrolls: remove Cherry override (unique); include Palm
      scroll: { reg: 'Norm', lucky: 'Luck', pine: 'Pine', deadwood: 'Dead', palm: 'Palm' },
      bow: { pine: 'Pine', deadwood: 'Dead', cherry: 'Cher', wooden: 'Wood', palm: 'Palm' },
      root: { fiji: 'Fiji', maui: 'Maui', sardinian: 'Sard', grenada: 'Gren' },
      potion: { fishing: 'Fish', stamina: 'Stam', mining: 'Mine', smithing: 'Smth', mischief: 'Crim' },
      jewelry: {},
      gem: {},
    };

    const applyManualFor = (cat: keyof typeof MANUAL, k: string): string | null => {
      const v = MANUAL[cat][k.toLowerCase()];
      return v || null;
    };

    const SCROLL_MAGICAL: Record<string, string> = {
      fire: 'Fire', water: 'Wat', nature: 'Nat', fury: 'Fury', rage: 'Rage', blood: 'Bld', alchemy: 'Alch', energy: 'En', warp: 'Warp', magic: 'Mag',
    };
    const POTION_MAP: Record<string, string> = {
      defense: 'Def', stamina: 'Stam', mining: 'Mine', smithing: 'Smth', lucky: 'Luck', sardinian: 'Sard',
    };
    const GEM_MAP: Record<string, string> = {
      amethyst: 'Am', sapphire: 'Sap', emerald: 'Em', ruby: 'Ruby', citrine: 'Cit', diamond: 'Dia', carbonado: 'Carb',
    };

    // 1) Potions: Potion of TYPE (N)
    const potionMatch = /^potion of\s+(.+?)\s*\((\d+)\)$/i.exec(n);
    if (potionMatch && this.settings.showPotions.value) {
      const type = potionMatch[1].trim();
      const doses = potionMatch[2];
      const mapped = POTION_MAP[type.toLowerCase()] || applyManualFor('potion', type) || capitalize3(type);
      return `${mapped} (${doses})`;
    }

    // 2) Logs
    const logsMatch = /^(.*?)\s*logs$/i.exec(n);
    if (logsMatch && this.settings.showLogs.value) {
      const prefix = logsMatch[1].trim();
      if (!prefix) return 'Norm';
      return applyManualFor('logs', prefix) || capitalize3(prefix);
    }

    // 3) Roots
    const rootMatch = /^(.*?)\s+root(s)?$/i.exec(n);
    if (rootMatch && this.settings.showRoots.value) {
      const prefix = rootMatch[1].trim();
      if (!prefix) return 'Norm';
      return applyManualFor('root', prefix) || capitalize3(prefix);
    }

    // 4) Scrolls
    const scrollsMatch = /^(.*?)\s*scrolls$/i.exec(n);
    if (scrollsMatch && this.settings.showScrolls.value) {
      const prefix = scrollsMatch[1].trim();
      // Magical scrolls list
      if (SCROLL_MAGICAL[prefix.toLowerCase()]) {
        if ((this as any).settings?.ignoreMagicalScrolls?.value) return null;
        return SCROLL_MAGICAL[prefix.toLowerCase()];
      }
      // Non-magical scrolls follow log-like rules
      if (!prefix) return 'Norm';
      return applyManualFor('scroll', prefix) || capitalize3(prefix);
    }

    // 5) Bows (and Unstrung Bows)
    if ((this as any).settings?.showBows?.value) {
      const bowMatch = /^(unstrung\s+)?(.+?)\s+bow$/i.exec(n);
      if (bowMatch) {
        const isUnstrung = !!bowMatch[1];
        const type = bowMatch[2].trim();
        const base = applyManualFor('bow', type) || capitalize3(type);
        return isUnstrung ? `${base} (u)` : base;
      }
    }

    // 5b) Ores
    if ((this as any).settings?.showOres?.value) {
      if (/^coal$/i.test(n)) return 'Coal';
      const nugget = /^(silver|gold)\s+nugget$/i.exec(n);
      if (nugget) {
        const metal = nugget[1].toLowerCase();
        return metal === 'gold' ? 'Gold' : capitalize3('Silver');
      }
      const oreMatch = /^(.+?)\s+ore$/i.exec(n);
      if (oreMatch) {
        const t = oreMatch[1].trim();
        const oreMap: Record<string, string> = {
          coal: 'Coal', iron: 'Iron', coronium: 'Coro', celadium: 'Cela', gold: 'Gold',
        };
        return oreMap[t.toLowerCase()] || capitalize3(t);
      }
    }

    // 5c) Bars
    if ((this as any).settings?.showBars?.value) {
      if (/^pig\s+iron\s+bar$/i.test(n)) return null; // excluded
      const barMatch = /^(.+?)\s+bar$/i.exec(n);
      if (barMatch) {
        const t = barMatch[1].trim();
        const barMap: Record<string, string> = {
          iron: 'Iron', coronium: 'Coro', celadium: 'Cela', gold: 'Gold',
        };
        return barMap[t.toLowerCase()] || capitalize3(t);
      }
    }

    // 6) Jewelry
    if ((this as any).settings?.showJewelry?.value) {
      // Monk's Necklace outlier
      if (/monk'?s\s+necklace$/i.test(n)) return 'Monk';
      const jewMatch = /^(silver|gold)\s+(.+?)\s+(necklace)$/i.exec(n);
      if (jewMatch) {
        const metal = jewMatch[1].toLowerCase();
        const mid = jewMatch[2].trim();
        const suf = metal === 'silver' ? '(s)' : '(g)';
        const gemAbbr = GEM_MAP[mid.toLowerCase()] || capitalize3(mid);
        return `${gemAbbr} ${suf}`;
      }
    }

    // 7) Gems
    if ((this as any).settings?.showGems?.value) {
      const rough = /^rough\s+(.+)$/i.exec(n);
      const justGem = /^(.+?)\s+gem$/i.exec(n); // Cut format provided as "GEMTYPE Gem"
      const m = rough || justGem;
      if (m) {
        const g = m[1].trim();
        const ab = GEM_MAP[g.toLowerCase()] || capitalize3(g);
        return ab;
      }
    }

    return null;
  }

  private formatTag(tag: string): string {
    // Capitalize words but keep numbers/symbols as-is
    return tag.replace(/\b([a-z])(\w*)/gi, (_, a: string, b: string) => a.toUpperCase() + b.toLowerCase());
  }

  private syncBadgeTypography(host: HTMLElement, badge: HTMLElement) {
    try {
      // Prefer sibling amount under the same host; fallback to any amount in document
      let amount = host.querySelector('.hs-inventory-item__amount') as HTMLElement | null;
      if (!amount) amount = document.querySelector('.hs-inventory-item__amount') as HTMLElement | null;
      if (amount) {
        const cs = getComputedStyle(amount);
        if (cs) {
          // Copy typography only; do not copy positional/background properties
          badge.style.fontSize = cs.fontSize || '';
          badge.style.lineHeight = cs.lineHeight || '';
          badge.style.fontFamily = cs.fontFamily || '';
          badge.style.fontWeight = cs.fontWeight || '';
          badge.style.fontStyle = cs.fontStyle || '';
          badge.style.letterSpacing = cs.letterSpacing || '';
          badge.style.textShadow = cs.textShadow || '';
        }
      }
    } catch {}
  }
}

function capitalize3(s: string): string {
  const t = s.trim();
  if (!t) return '';
  const seg = t.slice(0, 3);
  return seg.charAt(0).toUpperCase() + seg.slice(1).toLowerCase();
}
