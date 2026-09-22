import {
  PLUGIN_RENDERER_SLOTS,
  slotKeyError,
  slotPositionsError,
  type PluginRendererSlot,
  type PluginRendererSlotOptions,
} from "@pi-desktop/plugin-sdk";

/**
 * The renderer-side slot registry (`docs/plugin-plan/slot-contract.html`).
 *
 * A plugin's renderer entry registers components through `pi.slots.register`;
 * this store owns the resulting catalog. It is deliberately React-free so
 * logic tests can drive it directly — the React glue lives in `use-slots.ts`.
 *
 * Conflict semantics follow the contract: additive slots stack in
 * registration order and never clash; keyed slots (`toolCard` by tool name,
 * `blockRenderer` by `<pluginId>:lang`, `composerTrigger` by symbol) refuse a
 * second claim of the same key with `PLUGIN_SLOT_DUPLICATE`. Uninstalling a
 * plugin drops every registration it held, in one call.
 */

export type SlotErrorCode =
  | "PLUGIN_SLOT_UNKNOWN"
  | "PLUGIN_SLOT_DUPLICATE"
  | "PLUGIN_SLOT_INVALID_COMPONENT"
  | "PLUGIN_SLOT_INVALID_KEY"
  | "PLUGIN_SLOT_INVALID_POSITION";

/** A coded refusal from the registration path; surfaces verbatim to the plugin. */
export class SlotError extends Error {
  readonly code: SlotErrorCode;
  constructor(code: SlotErrorCode, message: string) {
    super(message);
    this.name = "SlotError";
    this.code = code;
  }
}

export type SlotSide = "left" | "right";

export type SlotEntry = {
  readonly id: string;
  readonly pluginId: string;
  readonly slot: PluginRendererSlot;
  readonly component: (props: Record<string, unknown>) => unknown;
  readonly options: PluginRendererSlotOptions;
  /** Resolved sides for additive slots; empty for the rest. */
  readonly sides: readonly SlotSide[];
  /** Keyed slots carry their key (`toolName`, `<pluginId>:lang`, trigger). */
  readonly key?: string;
};

export type SlotRegistrationHandle = {
  readonly slot: PluginRendererSlot;
  remove(): void;
};

type RegistryState = {
  /** Bumped on every mutation; the useSyncExternalStore snapshot key. */
  version: number;
  /** Insertion order across plugins is the presentation order. */
  entries: SlotEntry[];
};

function slotKeyFor(
  slot: PluginRendererSlot,
  options: PluginRendererSlotOptions | undefined,
): string | undefined {
  if (slot === "toolCard") return options?.toolName;
  if (slot === "blockRenderer") return options?.language;
  if (slot === "composerTrigger") return options?.trigger;
  return undefined;
}

export class SlotRegistry {
  private state: RegistryState = { version: 0, entries: [] };
  private listeners = new Set<() => void>();
  private nextId = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RegistryState => this.state;

  private commit(entries: SlotEntry[]): void {
    this.state = { version: this.state.version + 1, entries };
    for (const listener of this.listeners) listener();
  }

  /**
   * Register one slot component. Throws `SlotError` with a documented code
   * when the host refuses the registration.
   */
  register(
    pluginId: string,
    slot: unknown,
    component: unknown,
    options: PluginRendererSlotOptions | undefined,
  ): SlotRegistrationHandle {
    const slotName =
      typeof slot === "string" && (PLUGIN_RENDERER_SLOTS as readonly string[]).includes(slot)
        ? (slot as PluginRendererSlot)
        : null;
    if (!slotName) {
      throw new SlotError("PLUGIN_SLOT_UNKNOWN", `unknown slot: ${String(slot)}`);
    }
    if (typeof component !== "function") {
      throw new SlotError(
        "PLUGIN_SLOT_INVALID_COMPONENT",
        `slot ${slot} requires a function component`,
      );
    }
    const keyError = slotKeyError(slotName, pluginId, options);
    if (keyError) throw new SlotError("PLUGIN_SLOT_INVALID_KEY", keyError);
    const positionsError = slotPositionsError(slotName, options);
    if (positionsError) throw new SlotError("PLUGIN_SLOT_INVALID_POSITION", positionsError);
    const key = slotKeyFor(slotName, options);
    if (key !== undefined) {
      const clash = this.state.entries.find(
        (entry) => entry.slot === slotName && entry.key === key,
      );
      if (clash) {
        throw new SlotError(
          "PLUGIN_SLOT_DUPLICATE",
          `slot ${slot} key ${key} is already taken by ${clash.pluginId}`,
        );
      }
    }

    const sides: readonly SlotSide[] =
      slotName === "userAction" || slotName === "assistantAction" || slotName === "composerControl"
        ? (options?.positions ?? ["left", "right"])
        : [];
    const entry: SlotEntry = {
      id: `s${this.nextId++}`,
      pluginId,
      slot: slotName,
      component: component as SlotEntry["component"],
      options: options ?? {},
      sides,
      key,
    };
    this.commit([...this.state.entries, entry]);
    return {
      slot: slotName,
      remove: () => {
        this.commit(this.state.entries.filter((candidate) => candidate.id !== entry.id));
      },
    };
  }

  /** 卸载摘注册: drop every registration one plugin held. */
  unregisterPlugin(pluginId: string): void {
    const kept = this.state.entries.filter((entry) => entry.pluginId !== pluginId);
    if (kept.length !== this.state.entries.length) this.commit(kept);
  }

  /** Additive slots, in registration order, filtered to one side. */
  entriesForSide(slot: PluginRendererSlot, side: SlotSide): SlotEntry[] {
    return this.state.entries.filter(
      (entry) => entry.slot === slot && entry.sides.includes(side),
    );
  }

  /** Every registration of an additive slot, both sides, registration order. */
  entriesFor(slot: PluginRendererSlot): SlotEntry[] {
    return this.state.entries.filter((entry) => entry.slot === slot);
  }

  /** Keyed lookup: the one card for a tool, the one renderer for a language. */
  entryForKey(slot: PluginRendererSlot, key: string): SlotEntry | undefined {
    return this.state.entries.find((entry) => entry.slot === slot && entry.key === key);
  }
}

/** The app-wide singleton. Renderer host modules register through it. */
export const slotRegistry = new SlotRegistry();
