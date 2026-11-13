<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import Dialog from "../Dialog.svelte";
  let { path, onResolve }: { path: string; onResolve: (choice: "save" | "discard" | "cancel") => void } = $props();
</script>
<Dialog title={t("Save changes?")} onDismiss={() => onResolve("cancel")}>
  <p>{t("The file “{0}” has unsaved changes.", [path])}</p>
  {#snippet actions()}
    <button class="st-btn st-btn--quiet" type="button" onclick={() => onResolve("cancel")}>{t("Cancel")}</button>
    <button class="st-btn st-btn--danger" type="button" onclick={() => onResolve("discard")}>{t("Don't save")}</button>
    <button class="st-btn st-btn--primary" type="button" onclick={() => onResolve("save")}>{t("Save")}</button>
  {/snippet}
</Dialog>
<style>
  p {
    color: var(--text-body);
    font-size: 14px;
    line-height: 1.5;
    overflow-wrap: anywhere;
  }

</style>
