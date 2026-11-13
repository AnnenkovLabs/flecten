<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { numberIssue } from "../../lib/settings/validation";
  import SettingsRow from "./SettingsRow.svelte";

  interface Props {
    title: string;
    description?: string;
    value: number | undefined;
    min?: number;
    max?: number;
    scale?: number;
    integer?: boolean;
    optional?: boolean;
    oninput: (value: number | undefined) => void;
  }
  let { title, description, value, min = 1, max = Infinity, scale = 1,
    integer = true, optional = false, oninput }: Props = $props();
  const uid = $props.id();
  const issue = $derived(value === undefined && !optional ? t("Enter a number.") : numberIssue(value, min, max, integer));
</script>

<SettingsRow {title} description={description ?? ""}>
  <div class="st-control-stack">
    <input class="st-input st-input--number" type="number"
      min={min / scale} max={Number.isFinite(max) ? max / scale : undefined}
      step={integer && scale === 1 ? 1 : "any"}
      value={value === undefined ? "" : value / scale}
      placeholder={optional ? t("No limit") : undefined}
      aria-label={title} aria-invalid={issue ? "true" : undefined}
      aria-describedby={issue ? uid : undefined}
      oninput={(event) => oninput(event.currentTarget.value === "" && optional ? undefined : event.currentTarget.value === "" ? NaN : Number(event.currentTarget.value) * scale)} />
    {#if issue}<span id={uid} class="st-error" role="alert">{issue}</span>{/if}
  </div>
</SettingsRow>
