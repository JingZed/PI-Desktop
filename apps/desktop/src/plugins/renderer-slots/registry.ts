/**
 * The component-slot registry for trusted-renderer plugins (ADR 0287).
 *
 * Slots are registered at runtime, never declared in the manifest (D6), so this
 * is the single place the host learns that a plugin wants to draw somewhere. It
 * is deliberately a plain observable store rather than part of `app-store`: a
 * plugin registering a slot must not re-render the shell.
 */
import type { ReactNode } from "react";
import type { PiRendererSlotOptions, PluginRendererSlot } from "@pi-desktop/plugin-sdk";
import {
  codeBlockLanguageProblem,
  normalizeCodeBlockLanguage,
  type CodeBlockLanguageDiagnostic,
} from "./code-blocks";

/**
 * A component a plugin handed over. The SDK types this as returning `unknown`
 * so the plugin-facing contract carries no React dependency; the host is the
 * side that knows it is rendering React, and casts here.
 */
export type PluginSlotComponent = (props: Record<string, unknown>) => ReactNode;

export type PluginSlotRegistration = {
  pluginId: string;
  slot: PluginRendererSlot;
  component: PluginSlotComponent;
  /** `codeBlock` only: the fenced language this component claimed. */
  language?: string;
};

/**
 * Something a plugin tried that the host will not honour. Registration failures
 * are never silent (D6/D12): the plugins page and the diagnostics list read
 * these, so a plugin author sees why nothing appeared.
 */
export type PluginSlotDiagnostic = {
  pluginId: string;
  slot?: PluginRendererSlot;
  code:
    | "PLUGIN_SLOT_NOT_DECLARED"
    | "PLUGIN_SLOT_INVALID_COMPONENT"
    // Language admission for `codeBlock`; the rule itself lives in code-blocks.ts.
    | CodeBlockLanguageDiagnostic
    | "PLUGIN_SLOT_RENDER_FAILED"
    | "PLUGIN_SLOT_LOAD_FAILED"
    | "PLUGIN_INVALID: renderer entry must export onLoad";
  detail?: string;
  ts: number;
};

function keyFor(pluginId: string, slot: PluginRendererSlot): string {
  return `${pluginId}\u0000${slot}`;
}

class PluginSlotRegistry {
  /** Keyed by `(pluginId, slot)`, each list in registration order. */
  private readonly registrations = new Map<string, PluginSlotRegistration[]>();

  private readonly diagnostics: PluginSlotDiagnostic[] = [];

  private readonly listeners = new Set<() => void>();

  private version = 0;

  /**
   * Registers one component. Returns the handle the plugin uses to withdraw it,
   * or null when the host refused the registration — `codeBlock` additionally
   * needs the language it claims, which must be namespaced with its own id.
   */
  register(
    pluginId: string,
    slot: PluginRendererSlot,
    component: unknown,
    options?: PiRendererSlotOptions,
  ): { remove(): void } | null {
    if (typeof component !== "function") {
      this.report({
        pluginId,
        slot,
        code: "PLUGIN_SLOT_INVALID_COMPONENT",
        detail: `expected a component, received ${typeof component}`,
      });
      return null;
    }
    let language: string | undefined;
    if (slot === "codeBlock") {
      language = normalizeCodeBlockLanguage(options?.language);
      const problem = codeBlockLanguageProblem(pluginId, language);
      if (problem) {
        // A plugin that cannot claim the language must not keep a position it
        // will never be asked to draw (D13).
        this.report({ pluginId, slot, code: problem.code, detail: problem.detail });
        return null;
      }
    }
    const key = keyFor(pluginId, slot);
    const list = this.registrations.get(key) ?? [];
    const entry: PluginSlotRegistration = {
      pluginId,
      slot,
      component: component as PluginSlotComponent,
      ...(language === undefined ? {} : { language }),
    };
    list.push(entry);
    this.registrations.set(key, list);
    this.changed();
    return {
      remove: () => {
        const current = this.registrations.get(key);
        if (!current) return;
        const next = current.filter((candidate) => candidate !== entry);
        if (next.length) this.registrations.set(key, next);
        else this.registrations.delete(key);
        this.changed();
      },
    };
  }

  /** Every registration for one slot, across plugins, in registration order. */
  list(slot: PluginRendererSlot): PluginSlotRegistration[] {
    const out: PluginSlotRegistration[] = [];
    for (const [key, list] of this.registrations) {
      if (key.endsWith(`\u0000${slot}`)) out.push(...list);
    }
    return out;
  }

  /** Everything a plugin owns, dropped on unload / disable / uninstall (D10). */
  unregisterPlugin(pluginId: string): void {
    let touched = false;
    for (const [key, list] of [...this.registrations]) {
      if (!key.startsWith(`${pluginId}\u0000`)) continue;
      this.registrations.delete(key);
      touched = touched || list.length > 0;
    }
    if (touched) this.changed();
  }

  /** How many slots a plugin currently occupies, for the diagnostics surface. */
  countFor(pluginId: string): number {
    let total = 0;
    for (const [key, list] of this.registrations) {
      if (key.startsWith(`${pluginId}\u0000`)) total += list.length;
    }
    return total;
  }

  report(diagnostic: Omit<PluginSlotDiagnostic, "ts"> & { ts?: number }): void {
    this.diagnostics.push({ ts: Date.now(), ...diagnostic });
    // A plugin that misbehaves in a loop must not grow this without bound.
    if (this.diagnostics.length > 200) this.diagnostics.splice(0, this.diagnostics.length - 200);
    this.changed();
  }

  listDiagnostics(pluginId?: string): PluginSlotDiagnostic[] {
    return pluginId
      ? this.diagnostics.filter((entry) => entry.pluginId === pluginId)
      : [...this.diagnostics];
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Stable within a version, so `useSyncExternalStore` can compare snapshots. */
  snapshot = (): number => this.version;

  private changed(): void {
    this.version += 1;
    for (const listener of [...this.listeners]) listener();
  }

  /** Test seam: drop every registration and diagnostic. */
  reset(): void {
    this.registrations.clear();
    this.diagnostics.length = 0;
    this.changed();
  }
}

export const pluginSlots = new PluginSlotRegistry();

/** Test seam: back to a registry no plugin has ever touched. */
export function resetPluginSlots(): void {
  pluginSlots.reset();
}
