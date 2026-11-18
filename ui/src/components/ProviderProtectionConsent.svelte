<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { modal } from "../lib/modal";
  import { overlayPresence } from "../lib/overlay-presence";
  import { settings } from "../lib/settings.svelte";
  import Icon from "./Icon.svelte";
  import "./focus-dialog.css";

  const pending = $derived(settings.protection.pending);
  const gateway = $derived(pending?.inspection.gateway === "new-api" ? "New API" : pending?.inspection.gateway === "one-api" ? "One API" : "New API / One API");
  let enableButton = $state<HTMLButtonElement | null>(null);
</script>

{#if pending}
  <dialog
    class="protection-dialog focus-dialog"
    use:modal={() => enableButton}
    transition:overlayPresence|global
    aria-labelledby="provider-protection-title"
    aria-describedby="provider-protection-description"
    oncancel={(event) => event.preventDefault()}
    closedby="none"
  >
    <section class="protection-content focus-dialog__content">
      <Icon name="key" size={30} />
      <p class="protection-eyebrow">{t("Connecting to API {0}", [new URL(pending.baseUrl).host])}</p>
      <h1 id="provider-protection-title">{t("Hide keys and passwords from this API?")}</h1>
      <p class="protection-description" id="provider-protection-description">{t("Without protection, the API operator could save keys and passwords from files the agent reads, or alter AI replies to prompt a harmful command.")}</p>
      <section class="protection-benefits" aria-labelledby="provider-protection-benefits">
        <h2 id="provider-protection-benefits">{t("What protection does")}</h2>
        <ul>
          <li>{t("AI sees placeholders instead of detected keys and passwords. The app restores real values in commands and file changes.")}</li>
          <li>{t("The agent asks for your approval before running commands, changing files or visiting websites.")}</li>
        </ul>
      </section>
      <p class="protection-limits">{t("The access key for this API is still sent to its operator. Protection only hides secrets it can recognize.")}</p>
      <p class="protection-note">{t("Applies only to this API. You can turn it off later in its Advanced tab.")}</p>
      <details class="protection-details">
        <summary>{t("Why this warning?")}</summary>
        <p>{t("This API appears to use {0}, software for relaying AI requests. This does not prove its operator is malicious.", [gateway])}</p>
        <ul>
          {#each pending.inspection.evidence as evidence (`${evidence.id}:${evidence.source}`)}
            <li>{evidence.detail}</li>
          {/each}
        </ul>
      </details>
      <div class="protection-actions">
        <button class="protection-primary" type="button" bind:this={enableButton} onclick={() => settings.protection.decide(true)}>
          {t("Enable protection")}
        </button>
        <button class="protection-secondary" type="button" onclick={() => settings.protection.decide(false)}>
          {t("Continue without protection")}
        </button>
      </div>
    </section>
  </dialog>
{/if}

<style>
  .protection-dialog { position: fixed; inset: 0; width: 100vw; height: 100dvh; max-width: none; max-height: none; margin: 0; padding: 64px 28px; border: 0; background: transparent; color: var(--text); overscroll-behavior: contain; overflow-y: auto; }
  .protection-dialog[open] { display: grid; place-items: safe center; }
  .protection-content { width: min(100%, 600px); padding-block: 24px; }
  .protection-content > :global(.icon) { color: var(--text-2); }
  .protection-eyebrow { margin: 24px 0 12px; font-size: 13px; color: var(--muted); }
  h1 { margin: 0; font-size: clamp(26px, 4vw, 36px); line-height: 1.2; letter-spacing: -0.03em; font-weight: 500; text-wrap: balance; overflow-wrap: anywhere; }
  .protection-description { margin: 18px 0 0; color: var(--text-2); font-size: 15px; line-height: 1.7; text-wrap: pretty; }
  .protection-benefits { margin-top: 20px; color: var(--text-2); font-size: 15px; line-height: 1.6; }
  .protection-benefits h2 { margin: 0; color: var(--text); font-size: 15px; font-weight: 600; }
  .protection-benefits ul { margin: 10px 0 0; padding-inline-start: 20px; }
  .protection-benefits li + li { margin-top: 8px; }
  .protection-limits { margin: 16px 0 0; color: var(--text-2); font-size: 13px; line-height: 1.6; text-wrap: pretty; }
  .protection-note { margin: 12px 0 0; color: var(--muted); font-size: 13px; line-height: 1.6; text-wrap: pretty; }
  .protection-details { margin-top: 18px; color: var(--text-2); font-size: 13px; line-height: 1.6; }
  .protection-details summary { cursor: pointer; padding-block: 4px; }
  .protection-details p { margin: 8px 0; }
  .protection-details ul { max-height: 120px; overflow-y: auto; padding: 12px 14px 12px 28px; margin: 10px 0 0; background: var(--surface); border-radius: 8px; }
  .protection-details li { overflow-wrap: anywhere; }
  .protection-details li + li { margin-top: 8px; }
  .protection-actions { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 32px; }
  .protection-actions button { flex: 1 1 200px; min-height: 52px; padding: 12px 18px; border: 0; border-radius: 8px; font: inherit; font-size: 14px; font-weight: 600; white-space: normal; }
  .protection-primary { color: var(--on-primary); background: var(--primary); }
  .protection-secondary { color: var(--text-2); background: var(--raised); }
  button:focus-visible, summary:focus-visible { outline: 2px solid var(--primary); outline-offset: 4px; }
  @media (max-width: 600px), (max-height: 720px) {
    .protection-dialog { padding: 24px; }
    .protection-content { padding-block: 12px; }
    .protection-eyebrow { margin: 16px 0 10px; }
    .protection-description { margin-top: 14px; line-height: 1.6; }
    .protection-benefits { margin-top: 16px; }
    h1 { font-size: 26px; }
    .protection-actions { margin-top: 24px; }
  }
</style>
