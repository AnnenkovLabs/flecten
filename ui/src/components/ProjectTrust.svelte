<script lang="ts">
  import { onMount } from "svelte";
  import { t } from "../lib/i18n.svelte";
  import type { AgentInfo } from "../lib/types";
  import Icon from "./Icon.svelte";

  let { info, onResolve, onClose }: { info: AgentInfo; onResolve: (trusted: boolean) => Promise<void>; onClose: () => void } = $props();
  let dialog: HTMLDialogElement;
  let confirming = $state(false);
  let saving = $state(false);
  let error = $state("");
  onMount(() => { dialog.showModal(); });
  async function resolve(trusted: boolean): Promise<void> {
    if (saving) return;
    saving = true;
    error = "";
    try { await onResolve(trusted); onClose(); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { saving = false; }
  }
</script>

<dialog class="project-trust" bind:this={dialog} aria-labelledby="project-trust-title" aria-describedby="project-trust-description" oncancel={(event) => event.preventDefault()}>
  <button class="trust-close" type="button" aria-label={t("Close")} title={t("Close")} disabled={saving} onclick={onClose}><Icon name="x" size={20} /></button>
  <section class="trust-content">
    <Icon name="folder" size={30} />
    <p class="trust-eyebrow">{t("Project access")}</p>
    <h1 id="project-trust-title">{confirming ? t("Continue without trusting this folder?") : t("Do you trust this folder?")}</h1>
    <p class="trust-path">{info.projectRoot ?? info.cwd}</p>
    <p class="trust-description" id="project-trust-description">{confirming
      ? t("The agent can still use built-in tools, but project code extensions stay disabled. You can change this decision from the project menu.")
      : t("Trust enables project skills, modules, MCP servers and hooks. These can run code with your account permissions. Only trust folders you recognize.")}</p>
    {#if error}<p role="alert" class="trust-error">{error}</p>{/if}
    <div class="trust-actions" aria-busy={saving}>
      <button class="trust-primary" type="button" disabled={saving} onclick={() => void resolve(true)}>{t("Trust folder")}</button>
      <button class="trust-secondary" type="button" disabled={saving} onclick={() => confirming ? void resolve(false) : confirming = true}>{confirming ? t("Continue without trust") : t("Do not trust")}</button>
    </div>
    {#if saving}<p class="trust-status" role="status">{t("Saving…")}</p>{/if}
  </section>
</dialog>

<style>
  .project-trust { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 64px 28px; border: 0; background: transparent; color: var(--text); overscroll-behavior: contain; overflow-y: auto; }
  .project-trust[open] { display: grid; place-items: center; }
  .project-trust::backdrop { background: rgba(14,14,14,0.82); backdrop-filter: blur(12px); }
  .trust-close { position: fixed; top: 20px; right: 20px; display: grid; place-items: center; width: 40px; height: 40px; padding: 0; border: 0; border-radius: 8px; background: var(--surface); color: var(--text-2); }
  .trust-content { width: min(100%, 520px); padding-block: 24px; }
  .trust-content > :global(.icon) { color: var(--text-2); }
  .trust-eyebrow { margin: 24px 0 12px; font-size: 13px; color: var(--muted); }
  h1 { margin: 0; font-size: clamp(26px, 4vw, 36px); line-height: 1.2; letter-spacing: -0.03em; font-weight: 500; text-wrap: balance; }
  .trust-path { padding: 12px 14px; margin: 24px 0 18px; background: var(--surface); border-radius: 8px; color: var(--text); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; user-select: text; }
  .trust-description { margin: 0; color: var(--text-2); font-size: 15px; line-height: 1.7; text-wrap: pretty; }
  .trust-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
  .trust-actions button { min-height: 40px; padding: 10px 18px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 600; }
  .trust-primary { color: var(--on-primary); background: var(--primary); }
  .trust-secondary { color: var(--text-2); background: var(--raised); }
  button:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
  button:disabled { opacity: 0.6; cursor: wait; }
  .trust-error { color: var(--error); font-size: 13px; line-height: 1.5; }
  .trust-status { color: var(--muted); font-size: 13px; }
</style>
