<script lang="ts">
  import { tick } from "svelte";
  import { t } from "../lib/i18n.svelte";
  import Dialog from "./Dialog.svelte";
  import FloatingMenu from "./FloatingMenu.svelte";
  import Icon from "./Icon.svelte";

  let { user, onRename, onOpenSettings }: {
    user: { name: string; initial: string };
    onRename: (name: string) => void;
    onOpenSettings: () => void;
  } = $props();

  const formId = $props.id();
  let trigger = $state<HTMLButtonElement>();
  let input = $state<HTMLInputElement>();
  let menuOpen = $state(false);
  let editing = $state(false);
  let draft = $state("");
  let error = $state("");

  function focus(node: HTMLElement): void { node.focus(); }

  function startRename(): void {
    menuOpen = false;
    trigger?.focus();
    draft = user.name;
    error = "";
    editing = true;
    void tick().then(() => { input?.focus(); input?.select(); });
  }

  function save(event: SubmitEvent): void {
    event.preventDefault();
    const name = draft.trim();
    if (!name || name.length > 80) return;
    try {
      onRename(name);
      editing = false;
    } catch {
      error = t("Could not save name. Try again.");
    }
  }

  function menuKeydown(event: KeyboardEvent): void {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    menuOpen = false;
    trigger?.focus();
  }
</script>

<footer class="side-user">
  <button class="user-profile" class:is-open={menuOpen} type="button" bind:this={trigger}
    data-tooltip={user.name} aria-haspopup="dialog" aria-expanded={menuOpen}
    onclick={() => menuOpen = !menuOpen}
    oncontextmenu={(event) => { event.preventDefault(); menuOpen = true; }}>
    <span class="avatar" aria-hidden="true">{user.initial}</span>
    <strong class="user-name">{user.name}</strong>
  </button>
  <button class="user-settings" type="button" aria-label={t("Settings")} data-tooltip={t("Settings")} onclick={onOpenSettings}>
    <Icon name="settings" />
  </button>
</footer>

{#if menuOpen}
  <FloatingMenu anchor={trigger ?? null} label={t("Profile")} width={220} maxHeight={56}
    onClose={() => menuOpen = false} onkeydown={menuKeydown}>
    <div class="profile-menu">
      <button class="profile-menu-action" type="button" use:focus onclick={startRename}>
        <Icon name="edit" size={16} /><span>{t("Change name")}</span>
      </button>
    </div>
  </FloatingMenu>
{/if}

{#if editing}
  <Dialog title={t("Change name")} onDismiss={() => editing = false}>
    <form id={formId} onsubmit={save}>
      <label class="st-field">
        <span class="st-label">{t("Name")}</span>
        <input class="st-input" bind:this={input} bind:value={draft} maxlength={80} required autocomplete="nickname" />
      </label>
      {#if error}<p class="profile-error" role="alert">{error}</p>{/if}
    </form>
    {#snippet actions()}
      <button class="st-btn st-btn--quiet" type="button" onclick={() => editing = false}>{t("Cancel")}</button>
      <button class="st-btn st-btn--primary" type="submit" form={formId} disabled={!draft.trim()}>{t("Save")}</button>
    {/snippet}
  </Dialog>
{/if}

<style>
  .side-user {
    display: flex;
    align-items: center;
    gap: 4px;
    min-height: 48px;
    flex: none;
    padding: 4px 8px;
  }

  .user-profile, .user-settings {
    height: 40px;
    border-radius: 8px;
    color: var(--text-2);
    transition: background var(--t-touch) var(--ease), color var(--t-touch) var(--ease);
  }

  .user-profile {
    display: flex;
    align-items: center;
    flex: 1;
    gap: 10px;
    min-width: 0;
    padding: 0 8px;
    text-align: start;
  }

  .user-profile:hover, .user-profile.is-open, .user-settings:hover {
    background: var(--raised);
    color: var(--text);
  }

  .user-settings {
    display: grid;
    place-items: center;
    width: 40px;
    flex: none;
  }

  .avatar {
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    flex: none;
    border-radius: 50%;
    background: var(--raised-hover);
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
  }

  .user-name {
    overflow: hidden;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .profile-menu { padding: 4px; }
  .profile-menu-action { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 0 8px; border-radius: 6px; color: var(--text-2); font-size: 13px; text-align: start; }
  .profile-menu-action:hover { background: var(--raised); color: var(--text); }
  .profile-error { margin-top: 12px; color: var(--error); font-size: 13px; }

  @media (pointer: coarse) {
    .user-profile, .user-settings, .profile-menu-action { min-height: 44px; }
    .user-settings { width: 44px; }
  }
</style>
