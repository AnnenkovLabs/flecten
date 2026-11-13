<script lang="ts">
  import { t } from "../lib/i18n.svelte";
  import { settings } from "../lib/settings.svelte";
  import type { ProviderTestResult } from "../lib/types";
  import Icon from "./Icon.svelte";

  interface Props {
    providerId: string;
    modelCount: number;
    urlError: string;
  }

  interface TestState {
    status: "idle" | "testing" | "ok" | "error";
    message?: string;
    latencyMs?: number;
    model?: string;
    at?: string;
  }

  let { providerId, modelCount, urlError }: Props = $props();

  let testStates = $state<Record<string, TestState>>({});
  let modelChoice = $state<Record<string, string>>({});
  const models = $derived(Object.entries(settings.settings?.providers[providerId]?.models ?? {}));
  const model = $derived(models.some(([id]) => id === modelChoice[providerId]) ? modelChoice[providerId] : models.find(([id]) => settings.settings?.provider === providerId && id === settings.settings.model)?.[0] ?? models[0]?.[0]);
  const stateKey = $derived(`${providerId}:${model ?? ""}`);
  const testState = $derived<TestState>(testStates[stateKey] ?? { status: "idle" });

  async function testConnection(): Promise<void> {
    const id = providerId;
    const testedModel = model;
    const key = stateKey;
    const testing: TestState = { status: "testing" };
    if (testedModel) testing.model = testedModel;
    testStates = { ...testStates, [key]: testing };
    await settings.test(id, testedModel);
    const result: ProviderTestResult | null = settings.testResult;
    const tested: TestState = result
      ? {
          status: result.ok ? "ok" : "error",
          message: result.message,
          latencyMs: result.latencyMs,
          at: new Date().toISOString(),
        }
      : {
          status: "error",
          message: settings.error || t("The test returned no result."),
          at: new Date().toISOString(),
        };
    if (testedModel) tested.model = testedModel;
    testStates = { ...testStates, [key]: tested };
  }
</script>

<div class="test-row">
  {#if models.length > 0}<select class="st-select test-model" aria-label={t("Model to test")} value={model} disabled={settings.testing} onchange={(event) => modelChoice[providerId] = event.currentTarget.value}>{#each models as [id, definition] (id)}<option value={id}>{definition.name || id}</option>{/each}</select>{/if}
  <button
    class="st-btn st-btn--quiet"
    type="button"
    disabled={settings.testing || modelCount === 0 || Boolean(urlError)}
    onclick={testConnection}
  >
    <Icon name="refresh" size={14} />
    {testState.status === "testing" ? t("Testing…") : t("Test connection")}
  </button>
  {#if modelCount === 0}
    <span class="st-hint">{t("Add a model first.")}</span>
  {:else if urlError}
    <span class="st-hint">{t("Fix the API address.")}</span>
  {:else if testState.status === "testing"}
    <span class="st-hint"> {t("Testing text output from the model{0}. The draft will not be saved.", [testState.model ? ` ${testState.model}` : ""])} </span>
  {:else if testState.status === "ok" || testState.status === "error"}
    <span
      class="test-result"
      class:is-error={testState.status === "error"}
      role="status"
      title={testState.message ?? ""}
    >
      <Icon name={testState.status === "ok" ? "check" : "x"} size={13} />
      <span class="test-copy">
        <span>
          {testState.status === "ok" ? t("Text: response received") : t("Connection error")}
          {#if testState.latencyMs !== undefined}{t("· {0} ms", [testState.latencyMs])}{/if}
        </span>
        <span class="test-meta"> {t("{0}Tools were not tested.", [testState.model ? `${testState.model}. ` : ""])} </span>
        {#if testState.status === "error" && testState.message}
          <span class="test-message">{testState.message}</span>
        {/if}
      </span>
    </span>
  {/if}
</div>

<style>
  .test-row {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    flex-wrap: wrap;
  }
  .test-model { width: min(260px, 100%); }

  .test-result {
    display: inline-flex;
    align-items: flex-start;
    gap: 6px;
    max-width: 100%;
    color: var(--success);
    font-size: 12px;
    line-height: 1.45;
  }

  .test-result.is-error {
    color: var(--error);
  }

  .test-result :global(.icon) {
    margin-top: 2px;
  }

  .test-copy {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .test-meta,
  .test-message {
    color: var(--muted);
    font-size: 12px;
    overflow-wrap: anywhere;
  }

  .test-message {
    color: var(--error);
  }
</style>
