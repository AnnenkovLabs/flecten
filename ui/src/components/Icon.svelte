<script lang="ts">
  import { HugeiconsIcon } from "@hugeicons/svelte";
  import { ICONS } from "../lib/icons";
  import type { IconName } from "../lib/types";

  interface Props {
    name: IconName;
    size?: number;
    stroke?: number;
    class?: string;
  }

  let { name, size = 18, stroke = 1.7, class: className = "" }: Props = $props();
</script>

{#key name}
  <HugeiconsIcon
    icon={ICONS[name]}
    {size}
    strokeWidth={stroke}
    color="currentColor"
    class="icon {className}"
    aria-hidden="true"
    focusable="false"
  />
{/key}