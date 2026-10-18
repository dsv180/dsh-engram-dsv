# Plan for implementing multilingual support in the author's plugin `kenz1117/dsh-engram`

**Status:** draft for internal agreement. Not sent to the author in this form.
**Basis (updated 2026-10-18):** the upstream has moved ahead. `main` = `21e8252`, the author's latest release **v0.9.1**. Our PR #13 (language layer, 17.10), #23 (host peers optional, 18.10), #22 (CI gates, 18.10) are already merged into `main`. Our PRs #20 (Jev) and #21 (embedder) are open and under the author's review with blocking comments — they are consolidated in the "Remaining author requests" section below. Our local repository is branch `pr/optional-peers`, at the latest snapshot `d0d272d` on top of `3ad081e`; after the merge of #23 it lags behind `main` and needs rebasing.

**Structure:** Stage 0 (declaration) → Blocks А, Б, В, Г. Within a block: goal, integration condition, stages, tasks, input conditions, acceptance conditions, delivery conditions, result, expectations from the author.
**Numbering:** blocks — by letter, tasks — `А.01`, `Б.01`, `В.01`, `Г.01` (two-digit).

**What is not here:** our deadlines and effort estimates.

**Boundary conditions (for the whole task):**
- Database translation is a **one-time action** by the user: he sets the plugin to the desired language and does not switch languages back and forth during operation.
- Therefore, rollback to the old (Chinese) state is **not required**; only a checkpoint/resume in case the translation operation is interrupted is required.

**After the plan is worked through** (when all steps are agreed) — a separate analysis for over-engineering and possible optimization: where tasks can be compressed/merged without losing coverage.

---

## Which plan tasks close which open issues

The plan itself closes nothing — its tasks, executed per the plan, do the closing. Below shows which plan tasks lead to closing the author's open issues.

| Open issue / PR | What it closes | Plan tasks |
|---|---|---|
| PR #21 — Embedder as a deployment property | Block А (model selection mechanism) + author's review comments (remote-embedder tests, reindexing path, dimension mismatch) | А.01–А.12, Б.04, В.06 |
| PR #20 — Jev takes the provider and model from the host | Block Г.08 (Jev: connection resolution cache, non-blocking, warning about deprecated `jev.apiKey`) | Г.08 |
| PR #13 — language layer (merged into `main`) | Not closed by the plan (already merged); the reconciliation in Block Г relies on it | Г.01–Г.04 |
| Issue #14 — `jev.apiKey` (closed) | Design basis for PR #20; relation to Block Г.08 | Г.08 |
| Blocks Б, В — database translation, switching and safeguards | New scope: no existing issues, the plan proposes them for the first time | Б.01–Б.09, В.01–В.07 |

---

## Stage 0 — Declaration of current conditions and the dependency point on the author

This is a **declaration**, not a working step. It records the conditions we start with, and what will change when the author says which of his versions to start from.

**Declaration of current conditions:**
- Git is closed for us: we work not through the repository, but on our own build/artifact.
- We do **not fix the author's reference version in advance** — the author will suggest it (latest releases — 0.9.0 and 0.9.1). Until his answer, we take as the basis the state captured from the code: `0.8.14` (`main` = `3ad081e`), and locally we have the author's package `0.9.0` (`_ops/pkg-0.9.0`) for reconciliation.
- We work on our build (local repository at `3ad081e` + `d0d272d`), not on the published npm package.
- We do proofs and measurements on this build; we record input conditions and results in terms of the version the author will name.

**Dependency point on the author:** we agree the reference version with the author. When he says **which exact version of his we should start from**, we:
1. will re-verify the actual multilingual state in that version (dictionaries, language switcher, model) — by code, not by memory;
2. if it diverges from the current snapshot (0.8.14) — will redefine "from what state" we consider closure in Block Г;
3. will make corresponding edits in Blocks А–В (what already exists, what is ahead).

**Expectations from the author:** confirmation of the reference version (and its actual multilingual state) — **before the start of Block А**.

---

## Block А — Mechanism for flexible model selection to support multilingual

**Goal:** replace the hard-coded model with a resolution mechanism.

**Integration condition:** the replacement must, regardless of the language switcher, return the model that is hard-coded in the author's code (the Chinese `Xenova/bge-small-zh-v1.5`, 512 dimensions) — until the database work is complete.

**Stages:**
- 1. Inventory, node and selection — where the model appears in the code and how it is selected by language.
- 2. Per-language settings and default — storing settings, substitution of the hard-coded model, soft key validation.
- 3. Contracts and model fixation — dimension contract, guard against re-hard-coding, pinning and offline.
- 4. Verification and failure states — clinch on a copy of the database, list of failure states, reading on failure.

| № | Stage | Task | Goal | Input conditions |
|---|---|---|---|---|
| А.01 | 1. Inventory, node and selection | Inventory: all places in the code where the model identifier, dimension, cache path and embedding calls appear — direct + indirect (coverage: Variant C) | Find all places where the model/dimension/cache/calls appear, to understand what to change and what must not be broken | access to 0.8.14 sources |
| А.02 | 1. Inventory, node and selection | Node as the single source of truth: model identifier, dimension, embedder factory; default inherits the author's constant (coverage: Variant C — registry node + dimension in the interface) | Consolidate model/dimension/factory into one source of truth, so as not to spread it across the code | А.01 |
| А.03 | 1. Inventory, node and selection | Model selection mechanism relying on the plugin's language switcher (`config.language`) and on the language set globally in DSH; until a model is explicitly set — the language does not change the model (coverage: Variant C — both, with priority) | Select the model by language: plugin switcher → global DSH → default | А.02 |
| А.04 | 2. Per-language settings and default | Storing model settings for each language: `embedder` block (kind + models[lang] + default), Schemastery validation; **author's request per PR #21:** mock-fetch tests of the remote embedder (happy path, non-JSON body, timeout, vector count ≠ request), unknown keys inside `embedder` must not be silently ignored, `apiKeyEnv` should be read at call time, not at creation (coverage: Variant C). **Order (decided):** first the local path (`kind: local`), then attach the remote (`kind: remote`) — remote tests after local | Store model settings per language in one `embedder` block with validation; the remote path is covered by tests, not just code reading; the order — local, then remote | А.02, А.03 |
| А.05 | 2. Per-language settings and default | Substitution of the hard-coded model by default: at any position of the language switcher the output is the hard-coded model (coverage: Variant A — default from the node) | At any language the output — the hard-coded model (until the database is translated) | А.03, А.04 |
| А.06 | 2. Per-language settings and default | Settings layer: optional key; empty or unknown value = as if the key is absent (coverage: Variant A — soft validation, warning, not an error) | Optional key: empty/unknown value does not break, but warns | А.04 |
| А.07 | 3. Contracts and model fixation | Dimension contract: the node declares the dimension; reconciliation with the actual at store initialization; on mismatch — refusal with a reason (coverage: Variant A). **Author's request per PR #21:** `storedDim` must require agreement of both tables, not sampling a single row; integer check of BLOB length (not a multiple of 4 must not give a fractional "expected 153.25"); there is a test 512-base → 384-record, not only the reverse. **Limitation (decision):** the silent `Math.min` truncation in `vec.ts` is left as a known limitation, we do not fix it in this plan | Dimension mismatch does not remain silent: reconciliation at initialization, refusal with a reason; both sides are covered by a test | А.02, А.05 |
| А.08 | 3. Contracts and model fixation | Guard against re-hard-coding: a check that fails if the model identifier is again hard-coded outside the node (coverage: Variant A — guard test) | So that the model does not return to the code hard-coded outside the node | А.02 |
| А.09 | 3. Contracts and model fixation | Pinning and offline: fixed model identifier, version and path; silent download and silent update are forbidden; offline with cache — works, without cache — a clear error and degradation, start does not crash (coverage: Variant A — strict pinning) | The model is fixed; offline with cache — works, without cache — a clear error, start does not crash | А.02 |
| А.10 | 4. Verification and failure states | Clinch check: run on a copy of the database with and without the setting; reconciliation of generated vectors and results; if the core accesses the model directly — record the limitation (coverage: Variant C) | Verify on a copy: with and without the setting, vectors/results match; record the limitation | А.01–А.09, a copy of the database |
| А.11 | 4. Verification and failure states | List of failure states: model absent, not downloaded, dimension mismatch, record has no vector — with impact (read/write/ingest) and behavior (coverage: Variant C) | Know all failure states and their impact (read/write/ingest) | А.07, А.09 |
| А.12 | 4. Verification and failure states | Read behavior on failure: full-text search with an honest marker that the result is not semantic + the reason (coverage: Variant C) | On failure reading works: FTS with an honest marker "not semantic" + reason | А.11 |

**Boundary of Block А (fixed):** the active model is displayed in the panel as part of the selection (А.03/А.05) — this is not a separate task. The question "which model the database is on, how many records without a vector, what to do with it" — is the zone of Block Б (Б.02, Б.05, Б.06), not Block А.

**Input conditions of the block as a whole:** access to 0.8.14 sources; reference version confirmed by the author; the map of references (А.01) is compiled before making changes.

**Acceptance conditions:**
1. at any language the output is the hard-coded model, and the vector matches the reference — verified by equality, not "by eye";
2. there are no accesses to the model bypassing the node: the check fails if someone hard-codes it into the code again;
3. the author's config requires no edits: no key — behavior is unchanged;
4. on any failure search works, start does not crash, the trace is visible.

**Delivery conditions:** additive; disabled by default; taken without Blocks Б and В; we promise "model selection", not "multilingual as a whole"; rollback — delete the piece, data untouched.

**Result:** the mechanism can be used in the author's plugin code even without a decision on the database — a database built on the hard-coded model is processed by the same model, the rest of the logic does not change.

**Expectations from the author:** confirmation that such a model selection mechanism (relying on `config.language` and the global DSH language, with the hard-coded model by default) is compatible with his architecture — **after stage 3** (А.01–А.09).

---

## Block Б — Existing database built on the wrong model

**Database states (Б.0, fixed):** 1) no database; 2) empty database; 3) hard-coded model, all records with a vector; 4) some records without a vector; 5) dimension mismatch; 6) already on a different model; 7) mixed generations; 8) database without a label.

**Goal:** bring each database to an unambiguous state on the selected model — the database knows what it stands on (label), and states 4, 5, 7, 8 (some without a vector / dimension mismatch / mixed generations / without a label) are brought to one generation on the target model, without losses and with the possibility of rollback.

**Integration condition:** nothing changes on the author's side; translation — only by an explicit action; an untranslated database works as before.

**Stages:**
- 1. Determine state + label — Б.01, Б.02, Б.03. Does not depend on Block А (but the model must be ready at the output of Block А).
- 2. Transition and repair — Б.04, Б.05, Б.06. Requires Block А.
- 3. Measure and acceptance — Б.07, Б.08, Б.09.

### Tasks

| № | Stage | Task | Goal | Input conditions |
|---|---|---|---|---|
| Б.01 | 1. Determine state + label | Determine the actual state of the database (which of the 8) and which language came from the switcher (for the initial integration — Chinese, the default dies by the end) | Understand what we are working with: what state the database is in and which language came, to choose the action by the "state → action" map | live database, read access, language from Block А |
| Б.02 | 1. Determine state + label | Set the label (model marker): model identifier, dimension, generation, installation time — rather than deriving from BLOB length (coverage: Variant C — label in meta + reading for old databases) | So that the database knows what it stands on (model/dimension/generation/time), rather than deriving from BLOB length | Б.01 |
| Б.03 | 1. Determine state + label | Decision on the invariant: strictly "one database = one model and one generation" or mixed generations with a label on the record; selection criterion and consequences — in writing (coverage: Variant C — one generation in the end + label on the record) | Define the norm: one generation in the end; a label on the record allows translating in parts and verifying | Б.02 |
| Б.04 | 2. Transition and repair | Conversion directly on the live database: re-embedding records to the target model; what is not converted — into a separate file. The first step — a copy of the live database file (simple backup) before conversion; we do not do the restoration machinery (checkpoint/copy-run/protocol). **Author's request per PR #21 (decided):** the repository must have a reindexing path for non-empty vectors — we add a `--force` mode to `backfill-embeddings.mjs` (clear the vector through the store, then re-fill); we do not make an honest note in the README | Translate existing records to the target model directly on the live database; move what is not converted into a separate file; the "before" state is preserved by a copy of the file; the reindexing path for non-empty vectors appears in the repo (`--force` mode) | Б.01, Б.03; model ready (Block А) |
| Б.05 | 2. Transition and repair | "Repair" mode: records without a vector — a separate operation, not mixed with the model change (coverage: Variant A — re-embedding records without a vector, deterministically, without preview) | Add vectors to records without a vector, so that they become semantically searchable (deterministically) | Б.02 |
| Б.06 | 2. Transition and repair | Write policy on a runtime model failure: save without a vector + marker; later fixed by repair (Б.05) — without queue/counter/auto-retry (coverage: Variant A simplified; "not downloaded" = unfulfilled condition of Block А, not a model failure) | Do not lose a record on a runtime model/provider failure at the moment of writing; mark; later fill in with repair | model ready at the output of Block А, Б.01, Б.02 |
| Б.07 | 3. Measure and acceptance | Measure of correctness of new records: a set of pairs "new record in language L → query in the same language L, phrased in different words" (L — any, not only Russian: ru, en, fr, de), metric (hit@k); manual run (coverage: Variant A — simple measure) | Show that a new record after conversion lands correctly and is found by a query in the same language in different words | target model (Block А), registries for reading |
| Б.08 | 3. Measure and acceptance | Acceptance: (1) 100% of records of one generation, all with a vector; (2) by the Б.07 measure, a new record in any language (ru/fr/de) is found by a query in the same language in different words | Confirm: everything is converted without losses; new records land correctly | Б.04, Б.07 |
| Б.09 | 3. Measure and acceptance | Tests: old database without a label, new database, foreign dimension, mixed generations | Verify: old database without a label, new database, foreign dimension, mixed generations | Б.01–Б.08 |

**Input conditions of the block as a whole:** Block А is ready (the model is ready for work at the output); access to live databases; the invariant decision (Б.03) — from a human. **For the initial integration with the author:** we assume that **Chinese** came from the switcher (the hard-coded model) — this default is fixed as an entry condition; by the end of the work it dies, and only the actual language from Block А is accepted.

**Acceptance conditions:**
1. any database has an unambiguous answer "what it stands on" — read from the data, not guessed;
2. after conversion the database is in one generation, all records with a vector; new records land correctly — verified by the Б.07 measure (a new record in any language is found by a query in the same language in different words);
3. what was not converted — in a separate file, the database is not broken;

**Delivery conditions:** the label is additive; conversion — by an explicit action, not at start; for new users (after the rework) conversion is not required; we promise "translation without losses and without changing logic", not "automatic migration".

**Result:** the database is translated to the selected model directly on the live database; what is not converted is moved to a separate file.

**Expectations from the author:** confirmation that the database translation is performed by an explicit action and is not baked into the automation of his build — **after stage 1** (Б.01–Б.03).

---

## Block В — Mode switching and safeguards

**Goal:** separate "changing the look" from "changing the meaning of the data" and warn about the consequences.

**Integration condition:** changing the interface language does not change either the model or the data; any behavior change — only by an explicit choice.

**Stages:**
- 1. Boundaries of the switcher — what the language switcher actually affects and into what levels it divides.
- 2. Warnings and safeguards — warning, confirmation and the rule "only Block Б changes the data".
- 3. Verification and visibility — axis tests and the database language indicator.

### Tasks

| № | Stage | Task | Goal | Input conditions |
|---|---|---|---|---|
| В.01 | 1. Boundaries of the switcher | List of mechanisms that the language switcher actually affects — not only labels | Find what the language switcher actually affects (not only labels), so as not to miss hidden influence | map from Block Г |
| В.02 | 1. Boundaries of the switcher | Splitting the switching into two levels: only labels / labels + model + data (the middle level "labels + model" is discarded — it gives mixed generations) | Separate "changing the look" from "changing the meaning of the data", so that the language does not touch the excess | В.01 |
| В.03 | 2. Warnings and safeguards | Warning with a list of consequences before levels that change the data | The user knows the consequences before the level that changes the data | В.02 |
| В.04 | 2. Warnings and safeguards | Safeguards: confirmation before the level that changes the data; "by default nothing happens" (backup — in Б.04; rollback — not our concern, the copy already exists) | Nothing changes the data by accident: confirmation + "by default nothing" | В.03 |
| В.05 | 2. Warnings and safeguards | Rule: data translation is launched only by an operation from Block Б, not from the switcher | Data translation is not tied to the language switcher | В.02 |
| В.06 | 3. Verification and visibility | Tests: changing the language does not touch the model and data; changing the model does not touch the language; after cancel the data are the same; **author's request per PR #21:** on a dimension mismatch `search()` returns keyword-only with `degraded: true` (rather than losing FTS), replay ingest does not stall — per-pending catch | Prove that the language does not touch the model/data, and vice versa; after cancel the data are the same; mismatch degrades, rather than breaking search and ingest | В.02–В.05, А.07 |
| В.07 | 3. Verification and visibility | Database language indicator: decide where and how to display the divergence between the interface language and the database language, what complexities this will cause; agree the vision with the author (we do not decide details now) | A user who switched the language "to look" sees that the database is in a different language | В.02 |

**Input conditions of the block as a whole:** Block А (stages 1–4) and Block Б (result) are ready; the map of affected mechanisms (В.01) is compiled.

**Acceptance conditions:**
1. changing the language does not change the model and does not touch the data — verified by a test, not a promise;
2. changing the model does not change the language;
3. no level changes the data without confirmation, and after cancel the data are the same — reconciliation before and after;

**Delivery conditions:** only the visual part is safe by default; levels that change the data are disabled; we promise "warning and a barrier", not "automatic reconfiguration".

**Result:** by changing the interface language, one cannot accidentally change the data; the switcher can be handed to the author without fearing for the behavior.

**Expectations from the author:** confirmation of the separation of axes (look ≠ meaning) and that the levels that change the data are not baked into the switcher in his build — **after stage 1** (В.01–В.02).

---

## Block Г — Reconciliation with the already implemented multilingual support

**Note:** blocks А–В solve part of the common task of implementing multilingual support in an initially monolingual Chinese plugin. The subsystem is already partially implemented — dictionaries, language switching mechanisms. Blocks А–В rely on what has been created and are reconciled with its implementation.

**Goal:** align blocks А–В with the already implemented multilingual support — rely on it, not duplicate it, and make necessary changes to the implemented mechanisms without breaking them.

**Integration condition:** two parts — parallel (drives blocks А–В) and concluding (closes after achieving their goals).

### 1. Parallel (run together with А–В)

| № | Stage | Task | Goal | Input conditions |
|---|---|---|---|---|
| Г.01 | 1. Parallel | Map of what is already implemented: dictionaries (server-side `src/i18n/catalog/*` + client-side `src/client/locales/*`), the language switcher (`config.language`, `src/i18n/language.ts`), everything related to multilingual support | Record what is already implemented, so as to rely on it, not duplicate it | access to 0.8.14 sources |
| Г.02 | 1. Parallel | For each block А–В, determine the boundary conditions that must be taken into account | For each block А–В, know the boundary conditions that must be taken into account | Г.01 |
| Г.03 | 1. Parallel | As each block completes, record possible changes that will need to be made to the already implemented mechanisms | Accumulate changes for implementation along the blocks, rather than forgetting | Г.01, Г.02 |
| Г.04 | 1. Parallel | Each block's work takes into account the possibility of feedback on the already done work | Not "close" a block, but take into account feedback with what is already implemented | Г.01–Г.03 |

### 2. Concluding (after achieving the goals of А–В)

| № | Stage | Task | Goal | Input conditions |
|---|---|---|---|---|
| Г.05 | 2. Concluding | Reconciliation of the results of blocks А–В with the map (Г.01) | Verify that А–В are aligned with what is already implemented | А, Б, В completed |
| Г.06 | 2. Concluding | Applying the changes accumulated in Г.03 that were not fixed along the way (close the tails), while preserving existing behavior | Apply the remaining accumulated changes, without breaking existing behavior | Г.05 |
| Г.07 | 2. Concluding | Joint check: language → model → data work coherently, nothing is broken | Make sure that language → model → data work coherently | Г.05, Г.06 |
| Г.08 | 2. Concluding | Jev — do not touch, but assess where it can get in the way of our work and what this will entail (intersection risks); changes — only on a separate author's request. **Author's request per PR #20:** major — the tools path caches the first connection resolution (including an error) until the end of the process; fix — memoization within `ask` or not caching a resolution with an error + test; non-blocking — `jev-test` with an empty model, visibility of the degraded state, hoisting `describe()`, fallback "no declared / no settings"; from issue #14 — a one-time warning on a deprecated `jev.apiKey` | Do not touch Jev, but know the points of possible intersection and their consequences; the author's blocking comments on #20 are taken into account if we do touch Jev | — |

**Input conditions of the block as a whole:** the parallel part — together with А–В; the concluding part — А, Б, В are solved and the goals are achieved.

**Acceptance conditions:**
1. for each block А–В, the boundary conditions are defined and taken into account in planning and execution;
2. for each completed block, possible changes to the implemented mechanisms are recorded;
3. each block confirms that it relies on the implemented part, rather than creating a parallel one;
4. the accumulated changes are applied and verified;
5. joint check: language, model and data work coherently, nothing is broken.

**Delivery conditions:** additivity and "disabled by default" are preserved; changes to the already implemented mechanisms — only through an explicit decision.

**Result:** the implementation of multilingual support is completed coherently with the existing part of the plugin.

**Expectations from the author:** confirmation of the map of what is implemented (Г.01) and which changes to the already implemented mechanisms he is ready to accept — **in parallel, before the concluding part**.

---

## Remaining author requests (review of PRs #20 and #21, 18.10)

The author has reviewed both open PRs. Below — what he requires, where it lands in the plan and what remains open. The author's comments are in the PRs themselves (on upstream `kenz1117/dsh-engram`).

**PR #21 — embedder (three major block the merge):**
1. Remote-embedder tests: mock fetch — happy path, non-JSON body, timeout, vector count ≠ request. The PR body claimed tests that did not exist. → **А.04**.
2. Reindexing path for non-empty vectors: `backfill-embeddings.mjs` takes only `embedding IS NULL` and writes with raw SQL bypassing the store — it reindexes nothing non-empty. The author asks either for a `--force` mode (clear the vector through the store, then re-fill), or an honest "reindexing is not covered by the tool" in the README. **Decision (agreed):** we choose `--force`; we do not make an honest note in the README. → **Б.04**.
3. A dimension mismatch must not lose keyword search and stall ingest: `search()` in the vector branch catches `EMBEDDER_DIMENSION_MISMATCH` and returns keyword-only with `degraded: true`; the replay loop of ingest gets a per-pending catch, so that one record does not cut off the whole batch after a paid aux-LLM. → **В.06** (behavior) and **А.12** (reading on failure).

Non-blocking (take or leave): `storedDim` must require agreement of both tables, not sampling a single row; integer check of BLOB length (not a multiple of 4 must not give a fractional "expected 153.25"); `remote.ts` non-JSON error → `EMBEDDER_REMOTE_FAILED`, not a bare `SyntaxError`; unbounded total time of a large `embed()`; unknown keys inside `embedder` must not be silently ignored; `apiKeyEnv` is read at call time, not at creation; no test 512-base → 384-record. → **А.04**, **А.07**.

**PR #20 — Jev (one major blocks the merge):**
1. The tools path caches the first connection resolution (including an error) until the end of the process: `createMemoryJudge` does `cached ??= resolveConnection()` and does not invalidate. A transient failure is cached forever, Jev silently falls back to pure rules until a restart; a provider/key change in DSH does not reach the tools path. Fix — memoization within `ask` or not caching a resolution with an error + test. → **Г.08**.
2. Non-blocking: `jev-test` with an empty model short-circuits in vain; the degraded state is not visible in the panel; `readJevCatalog` calls `describe()` for each provider (needs hoisting); fallback "no declared / no settings" returns the whole catalog. → **Г.08**.
3. From issue #14 (Jev design accepted): a one-time warning on a deprecated `jev.apiKey` in the plugin config. → **Г.08**.

**Open on the author's side:** the author holds the question of the default model (multilingual as default) until the majors merge. Our А.05 (default = hard-coded model, until the database is translated) is consistent with this — we do not switch the default ahead of time.

---

## List of what we ask from the author (agreed separately)

1. Confirmation of the reference version and its actual multilingual state — **before Block А** (the author already has 0.9.0 and 0.9.1, the language layer in `main`; we wait for an explicit "we start with X").
2. Confirmation that the model selection mechanism (А) is compatible with his architecture — **after stage 3 of Block А**.
3. Confirmation that the database translation (Б) is performed by an explicit action and is not baked into the automation — **after stage 1 of Block Б**.
4. Confirmation of the separation of axes "look ≠ meaning" (В) and that the levels that change the data are not baked into the switcher — **after stage 1 of Block В**.
5. Confirmation of the map of what is implemented (Г.01) and which changes to the implemented mechanisms he is ready to accept — **in parallel, before the concluding part of Г**.
6. Comments and suggestions on the plan as a whole — **after the draft assembly, before handing it over to work**.

---

## What is not verified and is not stated as a fact

- Whether the author's core accesses the model directly, bypassing the setting points. Checked by А.01 and А.10.
- Whether the author's search fails on mixed dimensions or silently degrades (in the code — `Math.min` truncation, but the behavior on a real database is not measured). Checked by Б.02, Б.09.
- Why records were written without a vector when both models were in the cache — the cause is not established.
- Whose mechanism — the curated profile (`profile_blocks`) in the database; before transferring (if needed) one must look.
- What exactly quality the model change on real data will give for **old** records — is not measured (by decision: "before/after" comparison is discarded as meaningless); only that new records land correctly is checked (Б.07).
- **Known limitation (decision):** the silent `Math.min` truncation in `src/vec.ts` when comparing vectors of different lengths is left as is; the dimension contract (А.07) checks only at initialization. This means that when vectors of different lengths get into `cosine`, the behavior remains the same (truncation).
