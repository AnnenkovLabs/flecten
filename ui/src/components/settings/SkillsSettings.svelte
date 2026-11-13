<script lang="ts">
  import { t } from "../../lib/i18n.svelte";
  import { settings } from "../../lib/settings.svelte";
  import { extensions } from "../../lib/settings/extensions.svelte";
  import { SKILL_SOURCE_OPTIONS } from "../../lib/settings/skill-sources";
  import Icon from "../Icon.svelte";

  const skills = $derived(settings.info?.skills);
  const config = $derived(settings.settings);
  const sources = $derived(config?.skills?.sources ?? SKILL_SOURCE_OPTIONS.map((entry) => entry.id));
  const savedSources = $derived(settings.baseline?.skills?.sources ?? SKILL_SOURCE_OPTIONS.map((entry) => entry.id));
  const changed = $derived(SKILL_SOURCE_OPTIONS.some(({ id }) => sources.includes(id) !== savedSources.includes(id)));
  $effect(() => {
    void settings.baseline?.skills;
    if (settings.baseline) void extensions.loadSkills();
  });
</script>

<section class="settings-section" aria-labelledby="settings-skills">
  <h2 id="settings-skills">{t("Skills")}</h2>

  {#if config}
    <p class="st-hint">{t("Choose folders to load skills from. Your selection is saved in the current configuration.")}</p>
    {#each [{ id: "user", label: t("Shared folders") }, { id: "project", label: t("Project folders") }] as scope (scope.id)}
      <div class="st-group">
        <h3 class="st-group-title">{scope.label}</h3>
        <div class="st-card">
          {#each SKILL_SOURCE_OPTIONS.filter((entry) => entry.scope === scope.id) as entry (entry.id)}
            <label class="st-switch st-row">
              <span class="st-switch-copy">
                <strong>{entry.label}</strong>
                <span>{entry.path}</span>
              </span>
              <input type="checkbox" aria-label={entry.path}
                checked={sources.includes(entry.id)} disabled={settings.saving}
                onchange={(event) => {
                  const enabled = new Set(sources);
                  if (event.currentTarget.checked) enabled.add(entry.id);
                  else enabled.delete(entry.id);
                  config.skills = { ...config.skills, sources: SKILL_SOURCE_OPTIONS.filter((option) => enabled.has(option.id)).map((option) => option.id) };
                }} />
              <span class="st-switch-track" aria-hidden="true"></span>
            </label>
          {/each}
        </div>
      </div>
    {/each}
    <p class="st-hint">{t("Takes effect after saving, with no restart needed. Active tasks use the new set on their next run.")}</p>
    {#if sources.length === 0}
      <p class="st-hint">{t("All sources are disabled. No skills will be loaded after saving.")}</p>
    {/if}
    {#if changed}
      <p class="st-hint" role="status">{t("The saved set of skills is shown below. Save your changes to update the list.")}</p>
    {/if}
  {/if}

  <h3 class="st-group-title">{t("Loaded skills")}</h3>
  <button class="st-btn st-btn--quiet" type="button" disabled={extensions.busy || settings.dirty} onclick={() => extensions.loadSkills(true)}><Icon name="refresh" size={14} />{t("Reload skills")}</button>
  {#if extensions.error}<p class="st-error" role="alert">{extensions.error}</p>{/if}
  {#if extensions.skills.length > 0}
    {#each extensions.skills as skill (skill.name)}
      <details class="st-details">
        <summary>{skill.name}{#if skill.version}<span class="st-hint">v{skill.version}</span>{/if}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
        <div class="st-details-body">
          <p class="st-hint">{skill.description}</p>
          <p class="st-hint">{t("Source: {0}. Trust: {1}.", [skill.source === "project" ? t("project") : t("user"), skill.trust === "trusted" ? t("allowed") : t("requires approval")])}</p>
          <p class="st-hint st-mono">{skill.location}</p>
          {#if config}
            <label class="st-switch st-row">
              <span class="st-switch-copy"><strong>{t("Trust skill")}</strong><span>{t("Allow instructions to be loaded. Tool restrictions still apply.")}</span></span>
              <input type="checkbox" aria-label={t("Trust skill {0}", [skill.name])}
                checked={(config.skills?.trust?.[skill.name] ?? skill.trust) === "trusted"}
                disabled={settings.saving}
                onchange={(event) => {
                  config.skills = { sources: [...sources], ...config.skills, trust: { ...config.skills?.trust, [skill.name]: event.currentTarget.checked ? "trusted" : "untrusted" } };
                }} />
              <span class="st-switch-track" aria-hidden="true"></span>
            </label>
          {/if}
          <p class="st-hint">{t("Tools: {0}.", [skill.allowedTools?.join(", ") || t("shared session permissions")])}</p>
          {#if skill.resources.length > 0}
            <ul class="skill-resources">{#each skill.resources as resource (resource)}<li><button class="st-btn st-btn--quiet" type="button" onclick={() => extensions.previewSkill(skill.name, resource)}>{resource}</button></li>{/each}</ul>
          {:else}<p class="st-hint">{t("No additional files.")}</p>{/if}
          {#if extensions.resource?.name === skill.name}
            <div class="skill-preview">
              <p class="st-hint">{extensions.resource.path}{extensions.resource.truncated ? t(" (showing the start of the file)") : ""}</p>
              <pre>{extensions.resource.text}</pre>
              <button class="st-btn st-btn--quiet" type="button" onclick={() => (extensions.resource = null)}>{t("Close preview")}</button>
            </div>
          {/if}
        </div>
      </details>
    {/each}
  {:else}
    <div class="st-empty">{t("No skills.")}</div>
  {/if}

  {#if skills && skills.diagnostics.length > 0}
    <details class="st-details">
      <summary>{t("Skill issues: {0}", [skills.diagnostics.length])}<Icon name="chevron-down" size={14} class="st-chevron" /></summary>
      <div class="st-details-body">
        <div class="st-card">
          {#each skills.diagnostics as diagnostic, index (index)}
            <div class="diagnostic" class:is-error={diagnostic.level === "error"}>
              <span class="diagnostic-source">{diagnostic.source}</span>
              <span>{diagnostic.message}</span>
            </div>
          {/each}
        </div>
      </div>
    </details>
  {/if}
</section>
<style>
  .skill-resources { padding-left: 20px; color: var(--muted); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
  .skill-preview pre { max-height: 280px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; padding: 12px; background: var(--surface); font-size: 12px; }
  .st-mono { overflow-wrap: anywhere; }
</style>
