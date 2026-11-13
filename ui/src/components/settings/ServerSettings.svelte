<script lang="ts">
  import { tick } from "svelte";
  import type { HookRun } from "../../../../shared/hooks";
  import { HOOK_NAMES } from "../../../../shared/hooks";
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { copyHook, emptyHooks, hookCanBlock, hookEventLabel, hookLimit, hookSummary, hookTitle, moveHook, newHook } from "../../lib/settings/hooks";
  import type { HookEvent } from "../../lib/settings/hooks";
  import type { HookCommandSettings } from "../../lib/types";
  import HookHistory from "./HookHistory.svelte";
  import HookEditor from "./HookEditor.svelte";
  import Icon from "../Icon.svelte";

  let { runs = [] }: { runs?: HookRun[] } = $props();
  const uid = $props.id();
  let workspace: HTMLElement | undefined = $state();
  const config = $derived(settings.settings);
  let event = $state<HookEvent>("preToolUse");
  let filter = $state<HookEvent | "all">("all");
  let selected = $state<HookCommandSettings | null>(null);
  let pendingDelete = $state<HookCommandSettings | null>(null);
  let editor: HTMLDivElement | undefined = $state();
  const entries = $derived(HOOK_NAMES.flatMap((event) => (config?.hooks?.[event] ?? []).map((hook, index) => ({ event, hook, index }))));
  const visibleEvents = $derived(HOOK_NAMES.filter((event) => (filter === "all" || filter === event) && entries.some((entry) => entry.event === event)));
  const canAdd = $derived((config?.hooks?.[event]?.length ?? 0) < hookLimit());

  async function addHook(source?: HookCommandSettings, target = event): Promise<void> {
    if (!config) return;
    config.hooks ??= emptyHooks();
    if (config.hooks[target].length >= hookLimit()) return;
    const hook = source ? copyHook(source) : newHook();
    config.hooks[target] = [...config.hooks[target], hook];
    selected = config.hooks[target].at(-1) ?? null;
    filter = "all";
    await tick();
    editor?.querySelector<HTMLInputElement>("input")?.focus();
  }
  async function removeHook(target: HookEvent, index: number): Promise<void> {
    if (!config?.hooks) return;
    const hook = config.hooks[target][index];
    const position = entries.findIndex((entry) => entry.hook === hook);
    config.hooks[target] = config.hooks[target].filter((_, position) => position !== index);
    if (selected === hook) selected = null;
    pendingDelete = null;
    await tick();
    const triggers = workspace?.querySelectorAll<HTMLButtonElement>(".hook-select");
    const next = triggers?.[Math.min(position, triggers.length - 1)];
    (next ?? workspace?.querySelector<HTMLButtonElement>("[data-add-hook]"))?.focus();
  }
  async function changeEvent(from: HookEvent, index: number, target: HookEvent): Promise<void> {
    if (!config?.hooks || from === target || config.hooks[target].length >= hookLimit()) return;
    const hook = config.hooks[from][index];
    if (!hook) return;
    config.hooks[from] = config.hooks[from].filter((_, position) => position !== index);
    config.hooks[target] = [...config.hooks[target], hook];
    selected = config.hooks[target].at(-1) ?? null;
    filter = "all";
    if (hookCanBlock(target)) hook.async = false; else hook.failClosed = false;
    await tick();
    editor?.querySelector<HTMLSelectElement>("[data-hook-event]")?.focus();
  }
</script>

{#if config}
  <section bind:this={workspace} class="settings-section hooks-workspace" aria-labelledby="settings-hooks">
    <div class="hooks-heading">
      <h2 id="settings-hooks">{t("Hooks")}</h2>
      {#if entries.length}<span class="st-badge">{t("{0} enabled", [entries.filter(({ hook }) => hook.enabled).length])}</span>{/if}
    </div>
    <p class="st-hint">{t("Run your scripts or send an HTTP request when the agent reaches an event.")}</p>
    <div class="hooks-toolbar">
      <div class="st-field hooks-event"><label class="st-label" for={`${uid}-new-event`}>{t("When")}</label><select id={`${uid}-new-event`} class="st-select" bind:value={event}>{#each HOOK_NAMES as item (item)}<option value={item}>{hookEventLabel(item)}</option>{/each}</select></div>
      <button data-add-hook class="st-btn st-btn--quiet" type="button" onclick={() => addHook()} disabled={!canAdd || settings.saving}><Icon name="plus" size={14} />{t("Add hook")}</button>
    </div>
    {#if !canAdd}<p class="st-hint">{t("This event has reached its limit of {0} hooks.", [hookLimit()])}</p>{/if}
    {#if entries.length > 0}
      <div class="hooks-list-heading"><h3>{t("Your hooks")}</h3><div class="hooks-filter"><label class="st-hint" for={`${uid}-filter`}>{t("Events")}</label><select id={`${uid}-filter`} class="st-select" bind:value={filter}><option value="all">{t("All events")}</option>{#each HOOK_NAMES as item (item)}{#if config.hooks?.[item].length}<option value={item}>{hookEventLabel(item)}</option>{/if}{/each}</select></div></div>
      <p class="st-hint">{t("Hooks run from top to bottom within each event. A blocking decision stops the remaining hooks.")}</p>
      {#each visibleEvents as current (current)}
        <div class="hooks-group">
          <div class="hooks-group-heading"><h3>{hookEventLabel(current)}</h3><span class="st-hint">{hookCanBlock(current) ? t("Can block the action") : t("Observes only")}</span></div>
          {#each config.hooks?.[current] ?? [] as hook, index (hook.id ?? hook)}
            {@const expanded = selected === hook}
            <div class="hook-item" class:hook-item--open={expanded}>
              <div class="hook-item-heading">
                <button class="hook-select" type="button" aria-expanded={expanded} onclick={() => { selected = expanded ? null : hook; pendingDelete = null; }}>
                  <Icon name={expanded ? "chevron-down" : "chevron-right"} size={14} />
                  <span class="hook-identity"><strong>{hookTitle(hook)}</strong><span class="st-hint">{hook.type === "http" ? "HTTP" : t("Command")} · {hookSummary(hook)}</span></span>
                </button>
                <label class="st-switch hook-enabled"><input type="checkbox" aria-label={t("Enable hook {0}", [hookTitle(hook)])} bind:checked={hook.enabled} disabled={settings.saving} /><span class="st-switch-track" aria-hidden="true"></span></label>
                <span class="st-hint hook-state">{hook.enabled ? t("Enabled") : t("Disabled")}</span>
              </div>
              {#if expanded}
                <div class="hook-editor-wrap" bind:this={editor}>
                  <HookEditor {hook} event={current} {index} onchangeevent={(target) => changeEvent(current, index, target)} />
                  <div class="hook-actions">
                    <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={index === 0 || settings.saving} onclick={() => { if (config.hooks) config.hooks[current] = moveHook(config.hooks[current], index, -1); }}><Icon name="arrow-up" size={13} />{t("Move up")}</button>
                    <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={index === (config.hooks?.[current].length ?? 0) - 1 || settings.saving} onclick={() => { if (config.hooks) config.hooks[current] = moveHook(config.hooks[current], index, 1); }}><Icon name="arrow-down" size={13} />{t("Move down")}</button>
                    <button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={(config.hooks?.[current].length ?? 0) >= hookLimit() || settings.saving} onclick={() => addHook(hook, current)}><Icon name="copy" size={13} />{t("Duplicate")}</button>
                    <button class="st-btn st-btn--danger st-btn--sm hook-delete" type="button" disabled={settings.saving} onclick={() => pendingDelete = hook}><Icon name="trash" size={13} />{t("Delete hook")}</button>
                  </div>
                  {#if pendingDelete === hook}
                    <div class="st-confirm" role="group" aria-label={t("Delete hook")}><span>{t("Delete “{0}”?", [hookTitle(hook)])}</span><div class="st-confirm-actions"><button class="st-btn st-btn--quiet st-btn--sm" type="button" onclick={() => pendingDelete = null}>{t("Cancel")}</button><button class="st-btn st-btn--danger st-btn--sm" type="button" onclick={() => removeHook(current, index)}>{t("Delete")}</button></div></div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/each}
    {:else}
      <div class="hooks-empty"><Icon name="branch" size={24} /><h3>{t("Connect your workflow")}</h3><p class="st-hint">{t("Check a tool before it runs, add project context, or notify another service when work finishes. Choose an event above to create your first hook.")}</p></div>
    {/if}
    <HookHistory {runs} />
  </section>
{/if}

<style>
  .hooks-workspace { gap: 16px; }
  .hooks-workspace > p { margin: 0; }
  .hooks-heading, .hooks-list-heading, .hooks-group-heading, .hook-item-heading, .hooks-toolbar, .hook-actions, .hooks-filter { display: flex; align-items: center; gap: 12px; }
  .hooks-heading h2 { margin: 0; font-size: 20px; }
  .hooks-toolbar { align-items: end; margin: 0 0 8px; flex-wrap: wrap; }
  .hooks-event { flex: 1; max-width: 320px; min-width: min(200px, 100%); }
  .hooks-list-heading { justify-content: space-between; flex-wrap: wrap; }
  .hooks-list-heading h3, .hooks-group-heading h3, .hooks-empty h3 { font-size: 13px; font-weight: 600; color: var(--text); margin: 0; }
  .hooks-filter .st-select { width: auto; max-width: 230px; }
  .hooks-group { margin-top: 8px; }
  .hooks-group-heading { justify-content: space-between; flex-wrap: wrap; margin-bottom: 8px; }
  .hook-item { min-width: 0; border-top: 1px solid var(--line); }
  .hook-item--open { background: var(--surface); border-radius: 10px; border: 1px solid var(--line-strong); }
  .hook-item-heading { min-height: 64px; padding-right: 12px; gap: 8px; }
  .hook-select { display: flex; align-items: center; text-align: left; gap: 8px; flex: 1; min-width: 0; padding: 12px; align-self: stretch; border-radius: 8px; }
  .hook-select :global(svg) { flex: none; color: var(--muted); }
  .hook-identity { display: grid; gap: 4px; min-width: 0; overflow-wrap: anywhere; }
  .hook-identity strong { font-weight: 500; font-size: 13px; color: var(--text); }
  .hook-enabled { flex: none; min-height: 32px; }
  .hook-state { min-width: 52px; }
  .hook-editor-wrap { padding: 8px 16px 16px; display: grid; gap: 16px; }
  .hook-actions { gap: 8px; flex-wrap: wrap; padding-top: 8px; }
  .hook-delete { margin-left: auto; }
  .hooks-empty { display: grid; justify-items: start; gap: 12px; margin-top: 16px; padding: 24px 0; max-width: 56ch; }
  .hooks-empty :global(svg) { color: var(--muted); }
  @media (max-width: 650px) { .hook-state { display: none; } .hook-editor-wrap { padding-inline: 12px; } .hooks-group-heading { align-items: start; gap: 4px; flex-direction: column; } .hook-delete { margin-left: 0; } }
</style>
