<script lang="ts">
  import type { TwinCandidate, TwinSnapshot } from "../../../../shared/twin";
  import type { TwinStore } from "../../lib/twin.svelte";
  import { t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";
  import TwinCharacter from "./TwinCharacter.svelte";
  import TwinTrait from "./TwinTrait.svelte";
  import TwinTraitEditor from "./TwinTraitEditor.svelte";

  let { twin }: { twin: TwinStore } = $props();
  let query = $state("");
  let filter = $state<"all" | TwinCandidate["reaction"]>("all");
  let forgetting = $state<string | null>(null);
  let editing = $state<TwinSnapshot["entries"][number] | null>(null);
  const candidates = $derived(twin.snapshot?.candidates ?? []);
  const entries = $derived((twin.snapshot?.entries ?? []).filter((entry) => (filter === "all" || entry.reaction === filter) && (!query.trim() || `${entry.summary}\n${entry.content}\n${entry.appliesWhen}\n${entry.voice}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))));
  function edit(candidate: TwinCandidate): void { twin.editing = structuredClone($state.snapshot(candidate)); }
</script>

<section class="twin-profile" aria-label={t("Your character")}>
  <div class="twin-profile-intro"><TwinCharacter size={112} /><div><h2>{t("You, without repeating yourself.")}</h2><p>{t("Twin learns what makes you angry, what you like and what delights you. It keeps your original voice, including strong language.")}</p></div></div>
  <p class="twin-hint">{t("Learned traits apply immediately. Edit anything that does not sound like you.")}</p>
  <div class="twin-profile-controls"><label class="twin-search"><Icon name="search" size={16} /><input class="st-input" bind:value={query} placeholder={t("Search your character")} aria-label={t("Search your character")} /></label><label><span class="sr-only">{t("Reaction")}</span><select class="st-input" bind:value={filter}><option value="all">{t("All reactions")}</option><option value="anger">{t("Anger")}</option><option value="like">{t("Like")}</option><option value="delight">{t("Delight")}</option></select></label></div>
  {#each entries as entry (entry.id)}
    <article class="twin-trait" id={`twin-trait-${entry.id}`}>
      {#if editing?.id === entry.id}<TwinTraitEditor trait={editing} busy={twin.busy} onSave={async () => { if (editing) { await twin.update(editing); if (!twin.error) editing = null; } }} onCancel={() => editing = null} />{:else}<TwinTrait trait={entry} /><div class="twin-actions"><button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={twin.busy} onclick={() => editing = structuredClone($state.snapshot(entry))}>{t("Edit")}</button><button class="st-btn st-btn--quiet st-btn--sm" type="button" disabled={twin.busy} onclick={() => forgetting = entry.id}>{t("Remove trait")}</button></div>{/if}
      {#if forgetting === entry.id}<div class="twin-forget" role="alert"><p>{t("Remove this trait from Twin? Original history is kept.")}</p><div class="twin-actions"><button class="st-btn st-btn--danger" type="button" disabled={twin.busy} onclick={async () => { await twin.forget(entry.id, entry.revision); if (!twin.error) forgetting = null; }}>{t("Remove trait")}</button><button class="st-btn st-btn--quiet" type="button" onclick={() => forgetting = null}>{t("Cancel")}</button></div></div>{/if}
    </article>
  {:else}<p class="twin-empty">{query || filter !== "all" ? t("No matching traits. Clear the search or change the reaction.") : t("Your Twin is still getting to know you. Train it on your conversations to begin.")}</p>{/each}
  {#if candidates.length}<div class="twin-section-heading"><h2>{t("Earlier suggestions")}</h2><span>{candidates.length}</span></div>{#each candidates as candidate (candidate.id)}<article class="twin-trait">{#if twin.editing?.id === candidate.id}<TwinTraitEditor trait={twin.editing} busy={twin.busy} onSave={() => { if (twin.editing) void twin.review(twin.editing, "accept", true); }} onCancel={() => twin.editing = null} />{:else}<TwinTrait trait={candidate} /><div class="twin-actions"><button class="st-btn" type="button" disabled={twin.busy} onclick={() => twin.review(candidate, "accept")}>{t("Apply trait")}</button><button class="st-btn st-btn--quiet" type="button" disabled={twin.busy} onclick={() => edit(candidate)}>{t("Edit")}</button><button class="st-btn st-btn--quiet" type="button" disabled={twin.busy} onclick={() => twin.review(candidate, "reject")}>{t("Reject")}</button></div>{/if}</article>{/each}{/if}
</section>
