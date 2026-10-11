# dsh-engram-dsv — long-term agent memory across sessions

[Русская версия →](README.md) · A fork of [kenz1117/dsh-engram](https://github.com/kenz1117/dsh-engram)

A plugin for DeepSeek Harness that gives an agent memory surviving session close. Records live in a
plain SQLite file, are retrieved hybrid — by meaning and by words at once — and each one keeps its
provenance: which session and which turn it came from.

## What it is and why

By default an agent remembers exactly one conversation. Between sessions everything is lost:
agreements, your preferences, root causes you found, decisions together with their reasoning. You end
up explaining it all again.

The first half of the job is obvious: store the text so that it can be found in the next session. Any
notepad does that. But that half alone is not enough: a month later nobody can tell where a line came
from, what replaced it, or whether it can still be trusted. Memory you cannot trust is worse than no
memory at all — you rely on it and get it wrong.

The second half, the one usually skipped, is order. Every record carries its provenance (session and
turn), the history of what superseded it and why it was closed. That is why the plugin treats them as
no less important than storage itself: otherwise you end up with a pile of notes nobody can make sense
of.

The design rests on a memory palace:

- every record has a `room#slot` coordinate, and that is what memory is searched by;
- the tour route through rooms is fixed and only ever extended, so the order does not drift;
- a placard — a short date-anchored marker — is unique and distinguishable: it identifies a record
  without opening the text;
- the same subject always lands in the same room at the same slot, so neighbourhood works as a hint.

## Where this fork comes from

The original project is [kenz1117/dsh-engram](https://github.com/kenz1117/dsh-engram) by KenZ, MIT
licensed. Its documentation is in Chinese and English, and so are the strings in the code: the
language was wired into the engine.

To apply the author's design to Russian, we decided to add multilingual support and reworked that
part: a string dictionary and a Russian pack appeared — interface, prompts, service messages.

Halfway through the rework it became clear that language packs alone are not enough. Memory also
needs a suitable embedding model: the previous one, trained on Chinese, gave a mean cosine of 0.786 on
Russian records — tight enough that 382 of 703 record pairs fell inside the merge/arbitration zone,
meaning the system seriously considered merging unrelated facts. A multilingual model gives 0.294 and
no such pairs.

That is why the choice of model and backend was moved into configuration as well: a language is served
by a suitable model while the engine code stays common — there is no need to rewrite it for every new
language.

And not only Russian: all the text — labels, prompts, room names — lives in per-language packs rather
than in the code. Adding another language means translating a pack and registering it in a handful of
places (the language list, the dictionaries, room names, phrase-recognition patterns); the engine
logic itself does not have to be touched, and the compiler will say at once if a pack is missing keys.
The only thing that needs choosing separately is the embedding model, as happened with Russian.

The detailed description of the internals stays with the author:
[Chinese](README.upstream.zh.md) and [English](README.upstream.en.md). Thanks to the author: his engine
made it possible to add a language without rewriting the memory logic.

## What it does

**Memory and retrieval**

- Five kinds of records: fact, preference, decision, episode, skill.
- Three scopes: `project` — this project only, `user` — everything about you, `shared` — common
  ground. Each scope lives in its own database file.
- Hybrid retrieval: by meaning and by words at once. Without the embedder installed, retrieval keeps
  working by words — quietly, without errors and without losing data.

**Order and provenance**

- Every record has provenance: the session and turn it was extracted from.
- An operation journal: what was saved, what was rejected and why, what was superseded, what was
  closed.
- Closing a record is reversible and requires an epitaph: why we close it, whom it affects, whether
  any value remains. Later it can be excavated.
- A correction does not erase the old record: the new one joins a supersession chain and the chain
  history is kept.

**Working with time**

- Spaced repetition: today's queue, a cue without the text, a 0–5 self-grade; intervals are
  recalculated from how easily you recalled.
- An episode timeline: what was done on a given day or over a period, grouped by session.
- A view "as it was then": query facts as of a date rather than as of today.

**Generalisation**

- Distillation: similar records are merged into a higher-level pattern, the old ones are archived and
  the supersession chain is preserved.
- Beliefs: several records are merged into a statement with an evidence count; the source records stay
  in place.
- A tour of the palace: a themed route with several stops, so recall is coherent rather than in
  fragments.

**Capture from conversation**

- Turns are reviewed by an extractor model: what is worth remembering is saved, what is not is
  skipped. The model has the right to answer honestly "nothing to remember" — a separate event in the
  journal rather than an empty answer.
- A gentle mode is on by default: at most two candidates at a time, no assistant replies, plus an
  activity threshold — on short empty turns extraction does not even start.

## Agent tools

21 tools in total.

- **Search and read:** `engram_search`, `engram_examine`, `engram_facts`, `engram_timeline`,
  `engram_episode_timeline`, `engram_neighbors`, `engram_tour`, `engram_stats`, `engram_export`.
- **Write and edit:** `engram_save`, `engram_update`, `engram_forget`, `engram_profile_edit`.
- **Review:** `engram_review_queue`, `engram_review`, `engram_report`.
- **Generalisation, verification and audit:** `engram_reflect`, `engram_distill`,
  `engram_audit_forgotten`, `engram_assess`, `engram_ingest_history`.

## Where the text lives (dictionaries)

All of the plugin's text — panel labels, tool descriptions, prompts for the model, service messages —
lives in dictionaries. The code asks for text by key and knows nothing about the language, so a new
language means translating, not changing logic.

**Server half** — tool texts and model prompts, `src/i18n/catalog/`. Each language has 451 keys, and
the key count is identical in all three — that is checked separately.

| File | What it covers | Keys |
| --- | --- | --- |
| `src/i18n/catalog/tool.ts` | the 21 `engram_*` tools: schema descriptions, result texts, errors | 315 |
| `src/i18n/catalog/core.ts` | core: session profile, token budget, tour proposal, selection rationale, memory samples | 48 |
| `src/i18n/catalog/misc.ts` | panel HTTP routes, mirror export, update suggestions, placard check, Jev settings | 34 |
| `src/i18n/catalog/store.ts` | storage, backups, security, project binding, embedder | 29 |
| `src/i18n/catalog/llm.ts` | calls to the helper model: extraction, distillation, beliefs, query rewriting | 25 |

**Language-dependent data that is not a message:**

| File | What it covers |
| --- | --- |
| `src/i18n/messages.ts` | assembles the files above into a language dictionary and holds the active language |
| `src/i18n/language.ts` | the list of supported languages and system-language detection |
| `src/i18n/patterns.ts` | per-language phrase patterns: greetings, "do not remember this" |
| `src/i18n/dates.ts` | date and time words |
| `src/i18n/rooms.ts` | palace room names |

**Client half** — the memory panel, `src/client/locales/`: one file per language (`ru.ts`, `en.ts`,
`zh.ts`) plus `index.ts` with the key type. The client does not choose a language: it hands its
dictionaries to the host, and the renderer picks the right one from the DSH language setting.

**Entry format** — a key shaped `area.name` and the text; placeholders go in curly braces. The
fragment below is from the Russian dictionary:

```ts
export const ru = {
  'store.projectPalaceProcessDir': '{title} (каталог процесса)',
  'tool.searchDescription': 'Гибридный семантико-ключевой поиск по долговременным воспоминаниям…',
}
```

**What is missing falls back to English.** The author's primary language was Chinese: his original
wording still forms the base of the dictionaries. We made English the completeness reference — the
same convention the harness itself uses, where the fallback chain converges on English. So when a
language pack lacks a key, the English text is substituted: an empty label is worse than an English
one.

`node scripts/check-messages.mjs` guards this. It catches three things: a key the code asks for but
the dictionary does not know; a key declared but never requested; and a key missing from one of the
languages.

## What this fork changes

- **Full Russian support.** A string dictionary and a Russian pack covering the UI, the prompts and
  the service messages. Upstream keeps its strings in the code in Chinese and English; there is no
  Russian.
- **The embedding model is a setting.** Model and backend are chosen by configuration, so a language
  can be served by a suitable model without patching code. For Russian we use a multilingual MiniLM:
  the previous model, trained on Chinese, gave a mean cosine of 0.786 with 382 of 703 record pairs
  inside the merge/arbitration zone; the multilingual one gives 0.294 and no such pairs.
- **Extraction no longer inverts a denial.** The prompt now requires exact meaning: if something is
  denied in the text, the record keeps it denied. Measured: inverted records in 6 of 8 runs without
  the clause and 3 of 8 with it.
- **Extraction answers are no longer lost.** The answer budget went from 2000 to 4000 tokens:
  reasoning and the answer share one limit, and at 2000 the answer sometimes came back empty — which
  means a lost turn. Measured: empties in every arm at 2000, none in 16 calls at 4000.
- **The right to refuse honestly.** When there is nothing worth remembering, the model returns an
  explicit "nothing to remember" marker — a separate event in the log rather than an empty answer.
- **Assorted fixes.** A settings hint pointed at a parameter that does not exist; one skip reason did
  not match the panel dictionary and was never shown; a record could link to itself; room ids were
  made neutral; extra secret-detection patterns were added.

## Configuration

The block for a profile's `cordis.patch.yml`:

```yaml
- id: dsh-engram
  name: "@kenz1117/dsh-engram"
  config:
    ingest: light
    language: auto          # auto | ru | en | zh
    embedder:
      kind: local           # local | remote
      localModel: Xenova/paraphrase-multilingual-MiniLM-L12-v2
      localPooling: mean
```

- `ingest: light` — the gentle extraction mode described above.
- `language: auto` — the language of the UI, prompts and service messages follows the DSH settings;
  it can be pinned (`ru`, `en`, `zh`).
- `embedder.kind: local` — the model runs locally and nothing leaves the machine. The model is
  downloaded on first use, so network is needed once. `kind: remote` — compute embeddings on your own
  or an external service; only the text of the record being compared is sent out.

## Installation

1. Build: `pnpm install`, then `pnpm bundle`.
2. Pack: `pnpm pack` — this produces `kenz1117-dsh-engram-<version>.tgz`.
3. Install into a DSH profile: through the plugin menu (it accepts a tgz) or with
   `pnpm --dir <profile> add <file>.tgz`.
4. For local embeddings, install the model next to the plugin:
   `pnpm --dir <profile> add @huggingface/transformers`.
5. Append the configuration block (above) to `<profile>\cordis.patch.yml` and restart DSH.

Building assumes a machine that has DeepSeek Harness: some dependencies are linked to it as peers.
Verified on version `0.2.0-rc.2` with Node.js 24.21.0 — see the verification section. Detailed
documentation of the internals is [with the author](README.upstream.en.md).

**If something does not work** — a separate file with typical problems and hints: [INSTALL.md](INSTALL.md)
(in Russian: [INSTALL.ru.md](INSTALL.ru.md)). It is also written for an AI agent you ask to install the
plugin: it says what may be changed and what may not.

## What was verified and what was not

**Environment.** Built and verified on DeepSeek Harness `0.2.0-rc.2` (profile `desktop`), Node.js
24.21.0. Older harness versions were not tested and we do not vouch for them: the plugin declares its
compatibility without restrictions (it only needs Node 22.19+ or 24+), but that is the original
project's condition, not our verification.

**Platform.** Verified on **Windows only**. We have never run it on Linux or macOS. The sources contain
no operating-system checks at all, so nothing obviously Windows-only is there — but that is reading the
code, not a test.

Verified by running in this project:

- the interface string dictionary: 451 keys in each of the three languages, no discrepancies;
- no Chinese text is left in the sources outside comments;
- secret-detection patterns: 43 of 43;
- extraction prompt measurements: 48 and 64 model calls in two series — the numbers are in the
  changes section.

Not verified: `pnpm test` and `pnpm typecheck` were not run in our environment, because the tree does
not contain the DeepSeek Harness internals they need. If you build this yourself, start with them.

## If you found a problem

Reports go to this repository's issues: [open one](https://github.com/dsv180/dsh-engram-dsv/issues/new/choose).
The forms ask up front for what a report cannot be handled without: the harness version (`dsh --version`),
the plugin version, the operating system, the embedder mode, reproduction steps and journal entries.

Two rules we ask you to keep:

- **If AI wrote the text, a human must verify it** and take responsibility for it. The form has a field
  where you paste a confirmation phrase, and a question about which tools were used. This is not a
  formality: we answer people, not generated text.
- **No keys and no personal data.** Not in the text and not in screenshots: strip secrets and work data;
  if the report is impossible without them, describe their shape rather than their value.

The full rules are in [AI_POLICY.md](AI_POLICY.md).

Bugs in the engine itself (the palace, retrieval, the tools) are better reported
[upstream](https://github.com/kenz1117/dsh-engram): what belongs here is what concerns this fork —
Russian, embedder settings, installation.

## Roadmap

The project works but is not finished. This list is kept honestly, in the order we intend:

1. **Clear the technical debt.** Some decisions were taken deliberately and recorded as debt — they
   need closing rather than forgetting.
2. **More embedding models.** A multilingual MiniLM and a remote endpoint are verified so far; we
   want ready recipes for other languages and models, with measurements.
3. **Retry on an empty extraction answer.** The budget was raised, but there is no retry: if
   reasoning eats even 4000 tokens, the turn is lost silently.
4. **Verify a record against its source.** Instead of prohibitions in the prompt, compare the
   resulting record with the text of the turn. That treats inverted meaning at its root rather than by
   wording.
5. **Publish the measurement harness.** Our probes in a de-identified form, so the numbers can be
   re-checked instead of taken on trust.
6. **Send the changes upstream** — as a report or a pull request.
7. **Russian documentation** for the memory panel and the palace.

## Licence and acknowledgements

MIT, © 2026 KenZ (kenz1117) — the licence is kept unchanged, see [LICENSE](LICENSE).

Original project: [kenz1117/dsh-engram](https://github.com/kenz1117/dsh-engram). The architecture, the
engine, the tools and the documentation are the author's work. This fork adds the Russian language,
configurable embedding model and the fixes listed above.

The changes in this fork were made by the repository owner with the help of an AI assistant. Every
number and claim in this README comes from running the project, not from taking anyone's word.
