# Dictionary

The dictionary resolves domain terms before sending a request to the model. Users write natural prompts, and the harness injects matched definitions as a separate context block while preserving the raw user message verbatim. Looking up definitions requires no extra model call.

## Public Dictionary

Shared upstream source: [AnnenkovLabs/flecten, src/dictionary/data](https://github.com/AnnenkovLabs/flecten/tree/main/src/dictionary/data).

- `src/dictionary/data/index.json` lists category files.
- `src/dictionary/data/design.json` contains design terminology.
- `src/dictionary/data/ai-development.json` contains AI and software engineering terminology.
- Remaining categories cover agents, models, benchmarks, MCP, CSS and the web platform, developer tooling, infrastructure, mobile platforms, and product concepts.

111 entries were imported from `mera-os-public/os/memory/terms.jsonl` in `mera-os-public-0.3.9.zip` (version `0.3.9`, snapshot dated September 11, 2026; SHA-256 `f512595698f3190edc05ddfa805fb03ef8e74a3de564f294fa15f6d68e8db489`). Two overlapping entries, `Liquid Glass` and `Vibe coding`, kept their existing definitions. Imported entries retain their original HTTPS sources and common-pitfall clarifications; version and status notes in those definitions reflect the archive snapshot.

`Oh My Pi` was added from [can1357/oh-my-pi](https://github.com/can1357/oh-my-pi). The entry covers `OMP` (in both Latin and Cyrillic scripts), Russian and Ukrainian inflected forms, the website and package name, and all 80 phonetic and transliterated combinations of its three parts (`oh`/`o`, `my`, `pi`). Spaces, hyphens, concatenated spelling, and case are handled by the shared matcher. The bundled dataset totals 114 definitions.

Index format:

```json
{
  "schemaVersion": 1,
  "categories": ["design.json", "ai-development.json"]
}
```

Category file format:

```json
{
  "schemaVersion": 1,
  "category": "design",
  "entries": [
    {
      "id": "liquid-glass",
      "term": "Liquid Glass",
      "aliases": ["liquid glass ui", "apple liquid glass"],
      "category": "design",
      "definition": "Concise description of the technology and its purpose.",
      "clarification": "Distinguishes the term from similarly named concepts.",
      "sources": ["https://developer.apple.com/documentation/technologyoverviews/liquid-glass"]
    }
  ]
}
```

`id` remains stable when a definition is edited. `category` must match the enclosing file's category. `aliases` holds up to 128 explicit synonyms, translations, transliterations, and inflected forms. `clarification` is optional. `sources` lists HTTPS URLs for verification.

Seed definitions are compiled into the binary via JSON imports, so entries like `Liquid Glass` and `vibe coding` work offline. Sync fetches raw files from the `main` branch on GitHub, validates the index, every category file, ID uniqueness, and global caps, and atomically replaces `.flecten/dictionary/public.json` only when the entire set passes validation. On network or schema failure, the last known-good snapshot remains active and the UI displays the failure reason with a retry action. Automatic sync runs at most once every 24 hours; manual sync runs immediately.

Saved or downloaded public snapshots merge over bundled entries by `id`, replacing matching public definitions without hiding newer bundled entries missing from an older cache or remote index. Local definitions always take highest precedence.

Limits: up to 40 category files, 512 KiB per HTTP response, 4 MiB for the stored dataset, and 5,000 public entries. HTTP redirects are rejected. Category filenames allow only lowercase ASCII letters, digits, hyphens, and the `.json` extension.

## Local Dictionary

Local entries share the `DictionaryEntry` schema and live in project memory (`.flecten/memory.json`) as `kind: "vocabulary"` records keyed by `dictionary/<id>` with a structured `dictionary` payload. Provenance and revisions come from the memory store, giving local dictionary entries the same evidence checks, atomic writes, compare-and-swap revisions, deletion, and recovery guarantees.

The dictionary UI supports creating and editing entries without editing JSON. The agent can also persist an unfamiliar term via the `memory` tool when backed by a verbatim user explanation or a verified source; merely mentioning an unknown word never creates an entry. Local definitions remain scoped to the project, are never sent to the public repository, and override public entries with the same `id`.

## Term Matching

1. Unicode NFKC normalizes compatibility characters; matching is case-insensitive.
2. `Intl.Segmenter` establishes word boundaries. Spaces and common hyphen variants join multi-word terms, so `vibe coding`, `vibe-coding`, and `vibecoding` resolve to the same entry.
3. Physical key-map tables recover terms of 5+ characters typed in the wrong keyboard layout across English, Russian, and Ukrainian layouts (for example, typing `vibecoding` while a Russian layout is active still matches `vibecoding`).
4. Terms of 8-64 characters tolerate a single edit (insertion, deletion, substitution, or adjacent transposition). Ambiguous corrections that match multiple entries equally are rejected. Punctuation is never treated as a typo.
5. Exact matches take priority over corrected matches. Among equally exact matches, the longest phrase wins, overlapping spans are discarded, and repeated mentions emit the definition once.

The matcher never guesses translations, user intent, or unknown meanings; translations and transliterations belong in `aliases`. Short words skip fuzzy matching, and edit distance of two or more is intentionally disabled unless justified by false-positive measurements.

Dictionary context is strictly informational: it explains terminology without granting tool permissions, altering user instructions, or authorizing commands mentioned inside a definition.

A lexical match proposes a candidate meaning; the model disambiguates using the full prompt, conversation history, working directory, project files, and environment. For example, the `Oh My Pi` entry distinguishes the AI harness from the `Oh My Posh` shell theme engine and notes other meanings of `OMP` such as `OpenMP`. Recognizing a familiar name is not grounds to silently rewrite an unfamiliar one; the model should ask only when genuine ambiguity cannot be resolved from context.

The injected dictionary block is capped at 1,200 estimated tokens and available context headroom. `sources` and optional `clarification` fields are dropped first to preserve core definitions. If a single definition still exceeds the budget, its prefix is sent with an explicit `Definition truncated` marker while the full entry remains in the dictionary.

## Implementation and Tests

- `shared/dictionary.ts`: shared schemas and types for entries, categories, and IPC.
- `src/dictionary/normalize.ts`: Unicode normalization, separators, keyboard layouts, and single-typo recovery.
- `src/dictionary/match.ts`: candidate resolution and conflict handling.
- `src/dictionary/public.ts`: bundled dataset, remote sync, validation, and last known-good fallback.
- `tests/unit/dictionary.test.ts`, `dictionary-public.test.ts`: spelling variants, word boundaries, collisions, and public dataset integrity.
