<script lang="ts">
  import {
    appearance,
    CHAT_WIDTH,
    CODE_FONT_SIZE,
    isAppearanceCustomized,
    resetAppearance,
    setChatWidth,
    setCodeFontSize,
    setSummaryScale,
    setTerminalFontSize,
    setTextScale,
    SUMMARY_SCALE,
    TERMINAL_FONT_SIZE,
    TEXT_SCALE,
  } from "../../lib/appearance.svelte";
  import { t } from "../../lib/i18n.svelte";
  import {
    INTERFACE_SCALE,
    interfaceScale,
    setInterfaceScale,
  } from "../../lib/interface-scale.svelte";
  import Icon from "../Icon.svelte";
  import ScaleSlider from "./ScaleSlider.svelte";

  const customized = $derived(
    interfaceScale.percent !== INTERFACE_SCALE.default || isAppearanceCustomized(),
  );

  function resetAll(): void {
    setInterfaceScale(INTERFACE_SCALE.default);
    resetAppearance();
  }
</script>

<section class="settings-section appearance-settings" aria-labelledby="settings-appearance">
  <div class="appearance-head">
    <h2 id="settings-appearance">{t("Appearance")}</h2>
    <button
      class="st-btn st-btn--quiet st-btn--sm"
      type="button"
      disabled={!customized}
      onclick={resetAll}
    >
      <Icon name="refresh" size={14} />
      {t("Reset all")}
    </button>
  </div>
  <p class="st-section-description">
    {t("Adjust window zoom, reading sizes, and workspace typography. Changes apply immediately.")}
  </p>

  <div class="st-group">
    <h3 class="st-group-title">{t("Interface")}</h3>
    <div class="st-card">
      <ScaleSlider
        title={t("Interface scale")}
        description={t("Resize the entire window, including controls, menus, and layout.")}
        value={interfaceScale.percent}
        min={INTERFACE_SCALE.min}
        max={INTERFACE_SCALE.max}
        step={INTERFACE_SCALE.step}
        defaultValue={INTERFACE_SCALE.default}
        unit="%"
        onchange={setInterfaceScale}
      />
    </div>
  </div>

  <div class="st-group">
    <h3 class="st-group-title">{t("Chat and summaries")}</h3>
    <div class="st-card">
      <ScaleSlider
        title={t("Text scale")}
        description={t("Scale messages, Markdown replies, reasoning, and the composer input.")}
        value={appearance.textScale}
        min={TEXT_SCALE.min}
        max={TEXT_SCALE.max}
        step={TEXT_SCALE.step}
        defaultValue={TEXT_SCALE.default}
        unit="%"
        onchange={setTextScale}
      />
      <ScaleSlider
        title={t("HTML summary scale")}
        description={t("Scale interactive HTML summaries, tables, and diagrams in replies.")}
        value={appearance.summaryScale}
        min={SUMMARY_SCALE.min}
        max={SUMMARY_SCALE.max}
        step={SUMMARY_SCALE.step}
        defaultValue={SUMMARY_SCALE.default}
        unit="%"
        onchange={setSummaryScale}
      />
      <ScaleSlider
        title={t("Chat width")}
        description={t("Maximum width of the conversation column and composer.")}
        value={appearance.chatWidth}
        min={CHAT_WIDTH.min}
        max={CHAT_WIDTH.max}
        step={CHAT_WIDTH.step}
        defaultValue={CHAT_WIDTH.default}
        unit="px"
        onchange={setChatWidth}
      />
    </div>
  </div>

  <div class="st-group">
    <h3 class="st-group-title">{t("Code and terminal")}</h3>
    <div class="st-card">
      <ScaleSlider
        title={t("Code text size")}
        description={t("Font size for code blocks, diffs, file previews, and the IDE editor.")}
        value={appearance.codeFontSize}
        min={CODE_FONT_SIZE.min}
        max={CODE_FONT_SIZE.max}
        step={CODE_FONT_SIZE.step}
        defaultValue={CODE_FONT_SIZE.default}
        unit="px"
        onchange={setCodeFontSize}
      />
      <ScaleSlider
        title={t("Terminal text size")}
        description={t("Font size for the integrated terminal.")}
        value={appearance.terminalFontSize}
        min={TERMINAL_FONT_SIZE.min}
        max={TERMINAL_FONT_SIZE.max}
        step={TERMINAL_FONT_SIZE.step}
        defaultValue={TERMINAL_FONT_SIZE.default}
        unit="px"
        onchange={setTerminalFontSize}
      />
    </div>
  </div>
</section>

<style>
  .appearance-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
  }
  .appearance-head h2 {
    font-size: 20px;
    font-weight: 600;
    letter-spacing: -0.02em;
    line-height: 1.2;
    text-wrap: balance;
  }
</style>
