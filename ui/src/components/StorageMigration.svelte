<script lang="ts">
  import type { StorageMigrationState } from "../../../shared/storage-migration";
  import { i18n, t } from "../lib/i18n.svelte";
  import { modal } from "../lib/modal";
  import Icon from "./Icon.svelte";

  let { state: migration, onStart, onAccept }: {
    state: StorageMigrationState;
    onStart: () => Promise<void>;
    onAccept: () => Promise<void>;
  } = $props();
  let dialog: HTMLDialogElement;
  let action: HTMLButtonElement;
  let pending = $state(false);
  let error = $state("");
  const id = $props.id();
  function mandatoryModal(node: HTMLDialogElement) {
    const cancel = (event: Event) => event.preventDefault();
    node.addEventListener("cancel", cancel);
    const lifecycle = modal(node, () => migration.phase === "running" ? dialog : action);
    return { destroy() { node.removeEventListener("cancel", cancel); lifecycle.destroy(); } };
  }
  const steps = {
    inspect: "Checking saved data",
    backup: "Backing up saved data",
    merge: "Bringing chats together",
    verify: "Checking restored chats",
    publish: "Finishing migration",
  } as const;
  let busy = $derived(pending || migration.phase === "running");
  let heading = $derived(migration.phase === "complete"
    ? t("Your chats are ready")
    : migration.phase === "failed"
      ? t("Migration needs another try")
      : migration.phase === "running"
        ? t("Updating your saved chats")
        : t("Update your saved chats"));

  $effect(() => {
    const target = busy ? dialog : action;
    queueMicrotask(() => {
      if (dialog?.open) target?.focus({ preventScroll: true });
    });
  });

  async function submit(): Promise<void> {
    if (busy) return;
    pending = true;
    error = "";
    try { await (migration.phase === "complete" ? onAccept() : onStart()); }
    catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    finally { pending = false; }
  }
</script>

<dialog
  class="storage-migration"
  bind:this={dialog}
  use:mandatoryModal
  closedby="none"
  tabindex="-1"
  aria-labelledby={`${id}-title`}
  aria-describedby={`${id}-description`}
  oncancel={(event) => event.preventDefault()}
>
  <section class="migration-content">
    <Icon name="folder" size={30} />
    <p class="migration-eyebrow">{t("Saved chats")}</p>
    <h1 id={`${id}-title`}>{heading}</h1>
    <p class="migration-description" id={`${id}-description`}>{migration.phase === "complete"
      ? t("Your chats are available again. Copies of the original data have been preserved.")
      : migration.phase === "failed"
        ? t("Your original data has been preserved. Retry to continue from the saved progress.")
        : t("Flecten needs to update how your chats are stored. Your original data will be preserved.")}</p>
    {#if migration.phase !== "complete"}
      <p class="migration-note">{t("If the app closes or power is lost, migration resumes when you open it again.")}</p>
    {/if}
    {#if migration.phase === "running"}
      <div class="migration-progress" role="status" aria-live="polite" aria-atomic="true">
        <p>{t(steps[migration.step])}</p>
        <p class="migration-count">{t("Folders completed: {0} of {1}", [
          new Intl.NumberFormat(i18n.locale).format(migration.completed),
          new Intl.NumberFormat(i18n.locale).format(migration.total),
        ])}</p>
      </div>
    {/if}
    {#if migration.currentPath && migration.phase === "running"}
      <p class="migration-path">{migration.currentPath}</p>
    {/if}
    {#if migration.paths.length > 0 && migration.phase !== "complete"}
      <details class="migration-details">
        <summary>{t("Folders to update")}</summary>
        <ul>{#each migration.paths as path}<li>{path}</li>{/each}</ul>
      </details>
    {/if}
    {#if migration.backups.length > 0 && (migration.phase === "failed" || migration.phase === "complete")}
      <details class="migration-details">
        <summary>{t("Preserved copies")}</summary>
        <ul>{#each migration.backups as path}<li>{path}</li>{/each}</ul>
      </details>
    {/if}
    {#if error || migration.error}<p role="alert" class="migration-error">{error || migration.error}</p>{/if}
    <div class="migration-actions" aria-busy={busy}>
      <button class="migration-primary" type="button" bind:this={action} disabled={busy} onclick={() => void submit()}>{migration.phase === "complete"
        ? t("Continue")
        : migration.phase === "failed"
          ? t("Retry migration")
          : busy
            ? t("Migration in progress")
            : t("Start migration")}</button>
    </div>
  </section>
</dialog>

<style>
  .storage-migration { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 64px 28px; border: 0; background: transparent; color: var(--text); overscroll-behavior: contain; overflow-y: auto; }
  .storage-migration[open] { display: grid; place-items: center; }
  .storage-migration::backdrop { background: rgba(14,14,14,0.82); backdrop-filter: blur(12px); }
  .migration-content { width: min(100%, 520px); padding-block: 24px; }
  .migration-content > :global(.icon) { color: var(--text-2); }
  .migration-eyebrow { margin: 24px 0 12px; font-size: 13px; color: var(--muted); }
  h1 { margin: 0; font-size: clamp(26px, 4vw, 36px); line-height: 1.2; letter-spacing: -0.03em; font-weight: 500; text-wrap: balance; overflow-wrap: anywhere; }
  .migration-description { margin: 18px 0 0; color: var(--text-2); font-size: 15px; line-height: 1.7; text-wrap: pretty; }
  .migration-note { margin: 12px 0 0; color: var(--muted); font-size: 13px; line-height: 1.6; text-wrap: pretty; }
  .migration-path { padding: 12px 14px; margin: 18px 0; background: var(--surface); border-radius: 8px; color: var(--text); font-size: 13px; line-height: 1.6; overflow-wrap: anywhere; user-select: text; }
  .migration-progress { margin-top: 24px; color: var(--text-2); font-size: 13px; line-height: 1.6; }
  .migration-progress p { margin: 4px 0; }
  .migration-count { color: var(--muted); font-variant-numeric: tabular-nums; }
  .migration-details { margin-top: 18px; color: var(--text-2); font-size: 13px; line-height: 1.6; }
  .migration-details summary { cursor: pointer; }
  .migration-details ul { max-height: 120px; overflow-y: auto; padding: 12px 14px; margin: 10px 0 0; list-style: none; background: var(--surface); border-radius: 8px; }
  .migration-details li { overflow-wrap: anywhere; user-select: text; }
  .migration-details li + li { margin-top: 8px; }
  .migration-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
  .migration-actions button { min-height: 40px; padding: 10px 18px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 600; }
  .migration-primary { color: var(--on-primary); background: var(--primary); }
  button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
  button:disabled { opacity: 0.6; cursor: wait; }
  .migration-error { color: var(--error); font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
  @media (max-width: 600px) { h1 { font-size: 26px; } .storage-migration { padding: 32px 24px; } }
</style>
