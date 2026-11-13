<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { POLICY_OPTIONS, type ActionMeta, type Policy } from "../../lib/permissions";
  import Icon from "../Icon.svelte";

  interface Props {
    meta: ActionMeta;
    value: Policy;
    onChange: (policy: Policy) => void;
  }

  let { meta, value, onChange }: Props = $props();
</script>

<div class="perm-policy">
  <div class="perm-policy-copy">
    <span class="perm-policy-icon" aria-hidden="true">
      <Icon name={meta.icon} size={16} />
    </span>
    <span class="perm-policy-text">
      <span class="perm-policy-label">{meta.label}</span>
      <span class="perm-policy-desc">{meta.description}</span>
      {#if meta.risk}
        <span class="perm-risk">
          <span class="perm-risk-tag">{t("Risk")}</span>
          <span>{meta.risk}</span>
        </span>
      {/if}
    </span>
  </div>

  <div class="perm-seg" role="group" aria-label={t("Policy: {0}", [meta.label])}>
    {#each POLICY_OPTIONS as option (option.value)}
      <button
        class="perm-seg-btn"
        class:is-active={value === option.value}
        type="button"
        aria-pressed={value === option.value}
        title={option.description}
        onclick={() => onChange(option.value)}
      >
        {option.label}
      </button>
    {/each}
  </div>
</div>
