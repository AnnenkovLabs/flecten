<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type { ModuleState } from "../../../shared/modules";
  import { requestAgent } from "../lib/desktop";
  import type { ModuleHarness } from "../lib/modules/harness";
  import { ModulePortals } from "../lib/modules/portals";
  import { t } from "../lib/i18n.svelte";
  import { notifyModuleTheme, retainModuleStyles } from "../lib/modules/styles";

  let { snapshot, harness }: { snapshot: ModuleState; harness: ModuleHarness } = $props();
  let paused = $state(false);
  let error = $state("");
  let ready = $state(false);
  let portals: ModulePortals | undefined;
  const styles = new Map<string, HTMLStyleElement>();
  let ticket = 0;
  const selected = $derived(snapshot.interfaces.map((item) => `${item.module}:${item.revision}`).join("|"));

  function pause(): void {
    paused = true;
    try { localStorage.setItem("flecten.interface-paused", "true"); } catch { /* Optional recovery preference. */ }
  }
  function resume(): void {
    paused = false; error = "";
    try { localStorage.removeItem("flecten.interface-paused"); } catch { /* Optional recovery preference. */ }
  }
  onMount(() => {
    try { paused = localStorage.getItem("flecten.interface-paused") === "true"; } catch { /* Optional recovery preference. */ }
    ready = true;
    const recover = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key === "F12") { event.preventDefault(); pause(); }
    };
    window.addEventListener("keydown", recover, true);
    window.addEventListener("flecten.module.recover", pause);
    return () => { window.removeEventListener("keydown", recover, true); window.removeEventListener("flecten.module.recover", pause); ticket++; portals?.close(); for (const style of styles.values()) style.remove(); retainModuleStyles(new Set()); };
  });
  $effect(() => {
    if (!ready) return;
    const revision = selected;
    const disabled = paused;
    const current = ++ticket;
    const entries = disabled ? [] : untrack(() => $state.snapshot(snapshot.interfaces));
    const keep = new Set(entries.map((item) => `${item.module}:${item.revision}`));
    retainModuleStyles(keep);
    for (const [key, style] of styles) if (!keep.has(key)) { style.remove(); styles.delete(key); }
    portals?.close(); portals = undefined;
    if (disabled || !entries.length) return;
    Promise.all(entries.map(async (item) => {
      const key = `${item.module}:${item.revision}`;
      if (styles.has(key)) return;
      const response = await requestAgent({ type: "modules.styles", name: item.module, revision: item.revision });
      if (current !== ticket) return;
      const style = document.createElement("style");
      style.dataset.moduleStyle = item.module;
      style.textContent = (response.moduleStyles ?? []).join("\n");
      document.head.append(style); styles.set(key, style);
    })).then(() => {
      if (current !== ticket) return;
      for (const entry of entries) {
        const style = styles.get(`${entry.module}:${entry.revision}`);
        if (style) document.head.append(style);
      }
      notifyModuleTheme();
      const root = document.getElementById("app");
      if (!root) return;
      portals = new ModulePortals(root, harness, (message) => { error = message; });
      portals.update(snapshot.surfaces.filter((s) => s.placement));
    }).catch((cause) => { if (current === ticket) { error = String(cause); pause(); } });
    // The primitive revision keeps polling and chat updates from recreating custom interfaces.
    void revision;
  });
</script>

{#if snapshot.interfaces.length || paused || error}
  <div class="module-recovery" data-module-recovery="true">
    {#if error}<span role="alert">{error}</span>{/if}
    <button type="button" onclick={paused ? resume : pause} title="Ctrl+Shift+F12">{paused ? t("Resume module interfaces") : t("Restore native interface")}</button>
  </div>
{/if}
<style>
  .module-recovery { position: fixed; z-index: 2147483647; right: 12px; bottom: 12px; display: flex; gap: 8px; max-width: calc(100vw - 24px); align-items: center; }
  .module-recovery span { max-width: 50ch; padding: 8px; background: var(--bg); color: var(--text); font-size: 12px; overflow-wrap: anywhere; }
  .module-recovery button { min-height: 36px; padding: 6px 12px; border: 1px solid var(--line-strong); border-radius: var(--radius-sm); background: var(--raised); color: var(--text); font: inherit; font-size: 12px; cursor: pointer; }
</style>
