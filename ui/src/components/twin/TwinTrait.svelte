<script lang="ts">
  import type { TwinCandidate } from "../../../../shared/twin";
  import { t } from "../../lib/i18n.svelte";
  let { trait }: { trait: TwinCandidate } = $props();
</script>

<div class="twin-reaction" data-reaction={trait.reaction}>
  <strong>{trait.reaction === "anger" ? t("Anger") : trait.reaction === "delight" ? t("Delight") : t("Like")}</strong>
  <span aria-label={t("Strength: {0} of 3", [trait.strength])}>{#each [1, 2, 3] as level}<i class:filled={level <= trait.strength}></i>{/each}</span>
</div>
<h3>{trait.summary}</h3>
{#if trait.voice}<blockquote class="twin-original-voice">{trait.voice}</blockquote>{/if}
<p>{trait.content}</p>
<p class="twin-hint">{t("Use this when: {0}", [trait.appliesWhen])}</p>
<details class="twin-evidence"><summary>{t("Why Twin reacts this way")}</summary>{#each trait.evidence as evidence}<div>{#if evidence.precedingAssistant}<p class="twin-hint">{t("What the agent did")}</p><blockquote>{evidence.precedingAssistant}</blockquote>{/if}<p class="twin-hint">{t("Your reaction")}</p><blockquote>{evidence.quote}</blockquote><p class="twin-hint">{evidence.sourceId} · {evidence.reference}</p></div>{/each}</details>
