<script lang="ts">
  import { MorphIcon } from "morphicons/svelte";
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

<MorphIcon
  icon={ICONS[name]}
  {size}
  strokeWidth={stroke}
  class="icon {className}"
  aria-hidden="true"
  reducedMotion="user"
/>