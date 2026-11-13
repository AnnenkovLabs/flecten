<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import Icon from "../Icon.svelte";
  let { diff, onClose, onEdit }: { diff: { path: string; text: string; staged: boolean }; onClose: () => void; onEdit: () => void } = $props();
</script>
<section class="git-diff" aria-label="{t("Git changes")}"><header><span title={diff.path}>{diff.path}</span><small>{diff.staged ? t("Staged for commit") : t("Working copy")}</small><button type="button" onclick={onEdit}>{t("Open file")}</button><button type="button" aria-label="{t("Close Git changes")}" onclick={onClose}><Icon name="x" size={14} /></button></header><!-- svelte-ignore a11y_no_noninteractive_tabindex (The diff scroll region is keyboard accessible.) -->
<pre tabindex="0" role="region" aria-label="{t("Diff text")}">{diff.text || t("No text changes.")}</pre></section>
<style>
  section { display: flex; flex-direction: column; flex: 1; min-height: 0; min-width: 0; } header { display: flex; align-items: center; gap: 8px; padding-inline: 12px 6px; min-height: 34px; font-size: 12px; } header span { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; } small { color: var(--muted); font-size: 11px; } button { min-width: 28px; min-height: 28px; color: var(--text-2); } pre { flex: 1; min-height: 0; overflow: auto; margin: 0; padding: 12px 16px; font-family: var(--mono); font-size: 12px; line-height: 1.65; color: var(--text-2); tab-size: 2; } @media (max-width: 600px) { small { display: none; } }
</style>
