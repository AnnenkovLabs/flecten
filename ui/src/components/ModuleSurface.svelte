<script lang="ts">
  import { ModuleFrameRequestSchema, type ModuleSurface } from "../../../shared/modules";
  import { requestAgent } from "../lib/desktop";
  import { moduleFrame } from "../lib/modules/frame";
  import { i18n, t } from "../lib/i18n.svelte";
  import type { ModuleHarness } from "../lib/modules/harness";
  import { moduleTransfer } from "../lib/modules/transport";
  import { MODULE_THEME_EVENT, moduleThemeTokens, setModuleStyles } from "../lib/modules/styles";

  let { surface, sessionId = "", harness }: { surface: ModuleSurface; sessionId?: string; harness?: ModuleHarness } = $props();
  let frame = $state<HTMLIFrameElement>();
  let html = $state("");
  let error = $state("");
  let pending = 0;
  let subscribed = false;
  const moduleName = $derived(surface.module);
  const surfaceId = $derived(surface.id);
  const revision = $derived(surface.revision);

  $effect(() => {
    const name = moduleName;
    const id = surfaceId;
    const version = revision;
    const session = surface.placement ? "" : sessionId;
    let disposed = false;
    html = ""; error = "";
    requestAgent({ type: "modules.surface", ...(session ? { sessionId: session } : {}), name, surface: id, revision: version }).then((response) => {
      if (disposed) return;
      if (!response.ok || typeof response.moduleHtml !== "string") throw new Error(response.error ?? t("Could not load module surface"));
      html = moduleFrame(response.moduleHtml);
    }).catch((cause) => { if (!disposed) error = cause instanceof Error ? cause.message : String(cause); });
    return () => { disposed = true; };
  });

  $effect(() => harness?.subscribe((event) => {
    if (subscribed) frame?.contentWindow?.postMessage({ type: "flecten.module.event", event: moduleTransfer(event) }, "*");
  }));

  $effect(() => {
    frame?.contentWindow?.postMessage({ type: "flecten.module.locale", locale: i18n.locale }, "*");
  });

  async function receive(event: MessageEvent): Promise<void> {
    if (event.source !== frame?.contentWindow) return;
    if (event.data?.type === "flecten.module.ready") { frame?.contentWindow?.postMessage({ type: "flecten.module.initialize", html }, "*"); return; }
    if (event.data?.type === "flecten.module.recover") { window.dispatchEvent(new Event("flecten.module.recover")); return; }
    const parsed = ModuleFrameRequestSchema.safeParse(event.data);
    if (!parsed.success) return;
    if (pending >= 8) {
      frame.contentWindow?.postMessage({ type: "flecten.module.response", id: parsed.data.id, ok: false, error: t("Module request queue is full. Wait for a pending request to finish.") }, "*");
      return;
    }
    const target = frame.contentWindow;
    pending++;
    target?.postMessage({ type: "flecten.module.accepted", id: parsed.data.id }, "*");
    try {
      const request = parsed.data;
      const base = { name: surface.module, surface: surface.id, revision: surface.revision };
      let result: unknown;
      if (request.method === "snapshot" || request.method === "subscribe" || request.method === "request") {
        if (!harness) throw new Error("Harness bridge is unavailable");
        await requestAgent({ type: "modules.authorize", ...(sessionId && sessionId !== "current" ? { sessionId } : {}), ...base, request });
        if (request.method === "snapshot") result = harness.snapshot();
        else if (request.method === "subscribe") { subscribed = true; result = { subscribed: true }; }
        else if (request.command?.type === "interface.styles") { setModuleStyles(surface, request.command.css); result = { applied: true }; }
        else result = await harness.request(request.command);
      } else {
        const response = await requestAgent({ type: "modules.invoke", sessionId: harness?.session() ?? sessionId, ...base, request }, 300_000);
        result = response.moduleResult;
      }
      target?.postMessage({ type: "flecten.module.response", id: request.id, ok: true, result: moduleTransfer(result) }, "*");
    } catch (cause) {
      target?.postMessage({ type: "flecten.module.response", id: parsed.data.id, ok: false, error: cause instanceof Error ? cause.message : String(cause) }, "*");
    } finally { pending--; }
  }
  $effect(() => {
    const update = () => frame?.contentWindow?.postMessage({ type: "flecten.module.theme", tokens: moduleThemeTokens() }, "*");
    window.addEventListener(MODULE_THEME_EVENT, update);
    return () => window.removeEventListener(MODULE_THEME_EVENT, update);
  });
</script>
<svelte:window onmessage={receive} />
<section class="module-surface" aria-label={surface.title}>
  {#if error}<p role="alert">{error}</p>{:else if html}
    <iframe bind:this={frame} title={surface.title} sandbox="allow-scripts allow-forms" src="liquid-summary://module" referrerpolicy="no-referrer"></iframe>
  {:else}<p role="status">{t("Loading module surface…")}</p>{/if}
</section>
<style>
  .module-surface { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  iframe { width: 100%; flex: 1; border: 0; min-height: 0; background: var(--bg); }
  p { padding: 24px; color: var(--muted); overflow-wrap: anywhere; }
</style>
