<script lang="ts">
  import type { TwinStore } from "../../lib/twin.svelte";
  import { t } from "../../lib/i18n.svelte";
  import TwinCharacter from "./TwinCharacter.svelte";

  let { twin }: { twin: TwinStore } = $props();
</script>

<section class="twin-ask" aria-labelledby="twin-ask-title">
  <div class="twin-ask-character"><TwinCharacter state={twin.answer ? "answer" : "idle"} /></div>
  <h2 id="twin-ask-title">{t("Would Twin choose what you would?")}</h2>
  <p class="twin-hint">{t("Try a real decision. Twin picks the best supported option in your voice, just as it does for the Worker.")}</p>
  <form onsubmit={(event) => { event.preventDefault(); void twin.consult(); }}>
    <label for="twin-question">{t("Question for Twin")}</label>
    <textarea class="st-input" id="twin-question" bind:value={twin.question} maxlength="2000" rows="3" placeholder={t("How should we design checkout for this project?")} required></textarea>
    <button class="st-btn st-btn--primary" type="submit" disabled={twin.busy || !twin.snapshot?.enabled}>{twin.busy ? t("Asking Twin…") : t("Ask Twin")}</button>
    <p class="twin-hint">{t("Uses your configured model. Each answer shows its sources.")}</p>
  </form>
  <div class="twin-answer" role="status">
    {#if twin.answer}
      <h3>{twin.answer.abstained ? t("Twin needs your answer") : "Twin"}</h3>
      <p>{twin.answer.answer || t("No supported answer. Ask the user directly.")}</p>
      {#if twin.answer.entryIds.length}<p class="twin-hint">{t("Based on your character")}</p>{#each twin.answer.entryIds as id}{@const entry = twin.snapshot?.entries.find((item) => item.id === id)}{#if entry}<details class="twin-evidence"><summary>{entry.summary}</summary><p>{entry.content}</p>{#each entry.evidence as evidence}<blockquote>{evidence.quote}</blockquote>{/each}</details>{/if}{/each}{/if}
      <p class="twin-hint">{t("Input: {0} tokens · Output: {1} tokens", [twin.answer.usage.input, twin.answer.usage.output])}</p>
      <button class="st-btn st-btn--quiet" type="button" onclick={() => twin.tab = "profile"}>{t("View your character")}</button>
    {/if}
  </div>
</section>
