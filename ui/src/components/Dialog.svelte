<script lang="ts">
  import { modal } from "../lib/modal";
  import type { Snippet } from "svelte";
  import "./settings-surface.css";

  interface Props {
    title: string;
    description?: string;
    onDismiss: () => void;
    children?: Snippet;
    actions: Snippet;
  }

  let { title, description, onDismiss, children, actions }: Props = $props();
  const id = $props.id();


</script>

<dialog
  class="dialog st-dialog"
  use:modal
  aria-labelledby={`${id}-title`}
  aria-describedby={description ? `${id}-description` : undefined}
  oncancel={(event) => {
    event.preventDefault();
    onDismiss();
  }}
>
  <h2 id={`${id}-title`}>{title}</h2>
  {#if description}<p id={`${id}-description`} class="description">{description}</p>{/if}
  <div class="content">{@render children?.()}</div>
  <footer>{@render actions()}</footer>
</dialog>

<style>
  .dialog {
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100dvh - 32px);
    overflow-y: auto;
    padding: 24px;
    border-radius: 12px;
    box-shadow:
      inset 0 0 0 1px var(--line-strong),
      0 24px 64px rgba(0, 0, 0, 0.4);
  }

  h2 {
    margin: 0;
    font-size: 18px;
    font-weight: 600;
    line-height: 1.3;
    letter-spacing: -0.01em;
    text-wrap: balance;
  }

  .description {
    margin-top: 12px;
    color: var(--text-body);
    font-size: 14px;
    line-height: 1.5;
  }

  .content {
    display: grid;
    gap: 16px;
    margin-top: 16px;
  }

  footer {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 24px;
  }
</style>
