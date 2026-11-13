<script lang="ts">
  let { text }: { text: string } = $props();
</script>

<div class="msg user">
  <div class="bubble">{text}</div>
</div>

<style>
  .msg.user {
    display: flex;
    justify-content: flex-end;
    animation: msg-in 720ms var(--ease-jelly) both;
  }

  .bubble {
    position: relative;
    max-width: 85%;
    padding: 2px 0 2px 14px;
    color: var(--text-body);
    font-size: 16px;
    line-height: 1.6;
    white-space: pre-wrap;
    text-wrap: pretty;
  }

  .bubble::before {
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 2px;
    border-radius: 2px;
    background: var(--primary);
    content: "";
    transform-origin: top center;
    animation: rule-in 620ms var(--ease-jelly) both;
  }

  @keyframes msg-in {
    0% {
      opacity: 0;
      transform: translateY(11px) scale(0.985);
    }
    64% {
      opacity: 1;
      transform: translateY(-2px) scale(1.003);
    }
    100% {
      opacity: 1;
      transform: none;
    }
  }

  @keyframes rule-in {
    0% {
      opacity: 0;
      transform: scaleY(0.2);
    }
    62% {
      opacity: 1;
      transform: scaleY(1.04);
    }
    100% {
      opacity: 1;
      transform: none;
    }
  }
</style>
