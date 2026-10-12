# Installing dsh-engram-dsv

A detailed guide with the problems we ran into ourselves and how to get around them.
The short version is in [README.en.md](README.en.md); this file is for when something does not work.
По-русски: [INSTALL.ru.md](INSTALL.ru.md).

**If you are an AI agent doing the install:** go through the steps in order, run every command and show its
output to the human. Change nothing in the profile except `cordis.patch.yml` and `pnpm-workspace.yaml`.
Never open, print or copy keys. If a step fails, report the exact error, not a guess.

Two things people stumble over most often:

- the build (`pnpm bundle`) is mandatory — without it the package has no `lib/`, and DSH silently receives a
  plugin that cannot work;
- writing outside the working directory is normally forbidden for a sandboxed agent, and the DSH profile
  lives exactly there — deployment will need the human's permission (see "Sandbox and permissions").

## Requirements

- A working **DeepSeek Harness** installation. We built and tested on `0.2.0-rc.2`; older versions were not
  tested and we do not vouch for them.
- **Node.js** 22.19+ or 24+ — a requirement of the plugin itself (`engines` in its `package.json`).
- **The pnpm that ships with DSH**, not a third-party one: the profile is managed by that pnpm, and a foreign
  one can desynchronise the profile's `pnpm-lock.yaml`. The bundled pnpm lives at
  `<DSH>\resources\runtime\pnpm\bin\pnpm.cjs`, with its own Node next to it in `<DSH>\resources\runtime\`.
  Calling it by explicit path is safe: it is the same version DSH uses for profiles. pnpm may not be in
  `PATH` at all.
- **Network access once**, on the first run, to download the embedding model — unless you chose a remote
  embedder or accept keyword-only retrieval.
- Verified platform: **Windows**. We never ran it on Linux or macOS. The sources contain no OS checks at all
  (`win32`, `darwin`, `linux`, `process.platform` appear neither in `src` nor in `scripts`), so nothing is
  explicitly Windows-specific — but that is reading code, not testing. If you try it there, tell us how it
  went.

Below, `<DSH>` is the DeepSeek Harness installation directory and `<profile>` is the profile name (usually
`desktop`).

## Route

`git clone` → `pnpm install` → `pnpm bundle` → `pnpm pack` → `dsh plugin --profile <profile> add <file>.tgz`
→ edit `cordis.patch.yml` → verify. Building and packing are not formalities: the route
`dsh plugin add github:...` downloads the sources and runs `prepare`, but does **not** build `lib/`, so it
delivers a plugin that cannot work.

### 1. Get the sources

```bash
git clone https://github.com/dsv180/dsh-engram-dsv.git
cd dsh-engram-dsv
```

### 2. Install dependencies

```powershell
& "<DSH>\resources\runtime\node\node.exe" "<DSH>\resources\runtime\pnpm\bin\pnpm.cjs" install --config.verify-deps-before-run=false
```

The package runs a `prepare` step (`scripts/link-peers.mjs`) that links the DeepSeek Harness packages as
neighbours. If the output says all 19 packages were skipped, that is normal: on a machine with DSH already
installed they are found differently, and the build is unaffected. The
`--config.verify-deps-before-run=false` flag removes pnpm's refusal to run package scripts.

### 3. Build

```powershell
& "<DSH>\resources\runtime\node\node.exe" "<DSH>\resources\runtime\pnpm\bin\pnpm.cjs" bundle
```

This produces `lib/index.js` (the server half) and `lib/client.js` (the memory panel). **If there is no `lib`
directory, nothing further will work** — fix this step first.

### 4. Pack

```powershell
& "<DSH>\resources\runtime\node\node.exe" "<DSH>\resources\runtime\pnpm\bin\pnpm.cjs" pack
```

You get `kenz1117-dsh-engram-<version>.tgz` next to the repository — that is what goes into the profile.

### 5. Install into the profile

First, about pnpm 11: it no longer reads `pnpm.onlyBuiltDependencies` from the plugin manifest and treats
skipped native builds (`onnxruntime-node`, `protobufjs`, `sharp`) as an **error**. The permission lives in the
**profile's** `pnpm-workspace.yaml` (the manifest's copy is invisible to it, which is why it does not work):

```yaml
allowBuilds:
  - onnxruntime-node
  - protobufjs
  - sharp
```

Then install:

```powershell
dsh plugin --profile desktop add "<path>\kenz1117-dsh-engram-<version>.tgz" --ignore-scripts
```

Three traits that make this step more dangerous than it looks:

- **Success is indistinguishable from doing nothing.** A repeated run with the dependency already recorded
  returns `0` and does nothing. Judge the result not by the exit code but by the bundle list in
  `<profile>\package.json` (the `dsh.profile.bundles` field) and by the presence of the
  `<profile>\node_modules\@kenz1117\dsh-engram` directory.
- **An interrupted install leaves a lock** at `<profile>\package.json.lock` (6 bytes, containing a process
  PID). The next operation waits **121 seconds** and fails with
  `atomic-write: timed out waiting for the writer lock`. Fix: close DSH, delete `package.json.lock`, retry.
- **A failure on native builds leaves the profile modified.** So: `allowBuilds` first, install second.

The embedder `@huggingface/transformers` is a declared dependency of the plugin, and `dsh plugin add` installs
it along the way — no separate step is needed. It is needed only when deploying a bare build by hand
(`scripts/deploy-profile.mjs`):

```powershell
pnpm --dir "<profile>" add @huggingface/transformers
```

Without it the plugin still works, but keyword-only — silently, with no error.

### 6. Enable and configure

```yaml
- id: dsh-engram
  name: "@kenz1117/dsh-engram"
  config:
    ingest: light
    language: auto          # auto | ru | en | zh
    embedder:
      kind: local           # local | remote
```

Do **not** set the embedding model: it is chosen by language automatically — the native
`Xenova/bge-small-zh-v1.5` (512 dimensions) for Chinese, and the multilingual
`Xenova/paraphrase-multilingual-MiniLM-L12-v2` (384) for every other language. An explicitly set
`embedder.localModel` always wins over that substitution.

**Changing the model is not a one-word operation.** Vectors from the previous model have a different
dimension, and cosine similarity compares the shorter side: a mix of dimensions does not crash, it quietly
ruins retrieval. At startup the plugin compares the vector dimensions stored in the library against the
model's dimension and warns in the DSH log, and it records what actually came up in the operation journal
(`embedder-ready`). To fix it, re-embed:

```powershell
node scripts/backfill-embeddings.mjs
```

### 7. Coming up

The plugin normally mounts right after installation, with no restart: the memory panel appears in the DSH
settings immediately, and the memory profile arrives at the start of the next session. A restart is needed in
two cases: if the panel is still missing after half a minute — and always when you **replaced the build of an
already running plugin** (with the deployment script). Files are read at mount time, so new code takes effect
only at the next mount. The server half's language is likewise fixed at mount time.

### 8. Verify

```powershell
node scripts/check-journal.mjs
```

The script only reads the databases and answers three questions: which model came up, whether extraction is
running, and whether vector dimensions are mixed. After that: the memory panel in the DSH settings; a test
fact via `engram_save` and a search for it via `engram_search` (the record should come back with a room and a
placard); `engram_stats` — rooms, item counts, journal size. With a working embedder, semantic search finds a
record phrased in different words.

## Sandbox and permissions

If a sandboxed AI agent performs the install (for example DSH with the `workspace-write` policy), writing
**outside the working directory is forbidden**, and the DSH profile is exactly there. The symptom: deployment
fails with `EPERM`, and creating any new file in the profile directory fails with "Access to the path ... is
denied". This is not a locked file: reading from the profile still works. Fix: the human runs the deployment
step themselves, or grants the agent wider access for that one command.

## When something does not work

| What you see | Why | What to do |
| --- | --- | --- |
| No plugin at all | The entry was added to `cordis.yml`, which is always empty | Edit the profile's `cordis.patch.yml` — `cordis.yml` says so itself |
| `pnpm install` fails on `prepare` / `link-peers.mjs` | The DeepSeek Harness packages are not visible as neighbours | Run the install where DSH exists, with the flag from step 2. "All 19 skipped" is normal |
| `dsh plugin add` returned `0` but there is no plugin | The dependency is already recorded: the command is not idempotent and silently does nothing | Check `dsh.profile.bundles` in `<profile>\package.json`; remove the stale entry and repeat step 5 |
| An operation waits 121 seconds and fails with `atomic-write: timed out waiting for the writer lock` | An interrupted install left the `package.json.lock` lock | Close DSH, delete `<profile>\package.json.lock`, retry |
| `dsh plugin add` fails with `ERR_PNPM_IGNORED_BUILDS: onnxruntime-node…` | The profile's `pnpm-workspace.yaml` has no `allowBuilds` (pnpm 11 ignores the manifest field) | Add `allowBuilds` to the profile and retry; a failure leaves the profile modified, so permission first, install second |
| `pnpm bundle` succeeds but nothing changes in DSH | The build never reached the profile; or you replaced code of a running plugin | Repeat step 5; when replacing code, restart DSH |
| Deployment fails with `EPERM`, no new file can be created in the profile | The agent's sandbox forbids writes outside the working directory | See "Sandbox and permissions" |
| Search matches words only, never meaning | `@huggingface/transformers` is not installed next to the plugin — the fallback is silent | `node scripts/check-journal.mjs` will say there are no vectors; install the package (step 5) |
| Records exist but semantic search lies | The library holds vectors of different dimensions — the model was changed without re-embedding | `node scripts/check-journal.mjs` prints the dimensions; re-embed with `node scripts/backfill-embeddings.mjs` |
| The first search takes very long | The embedding model is being downloaded (one time) | Wait; for an offline machine set `embedder.kind: remote` or accept keyword-only retrieval |
| Text appears in the wrong language | The server half's language is fixed when the plugin mounts | Change `language` and restart; `auto` follows the system locale, and a language without a dictionary falls back to English |
| Config load fails with `language must be one of auto\|zh\|en\|ru` | A typo in `language` | Use one of the four values |
| Nothing is captured from the conversation | `ingest: light` deliberately skips short quiet turns, and an honestly empty model answer is a separate event | `node scripts/check-journal.mjs` shows request counts, successes and skip reasons |
| A command with JavaScript inside fails on Windows | PowerShell eats quotes and backticks in one-liners | Write the script to a file and run the file |

## Where the data lives

All plain SQLite files in the DSH home directory, in the `engram/` folder:

- `user.db` — records in the `user` scope (shared across all workspaces);
- `project-<hash>.db` — one file per workspace (`project` scope); empty files are normal, not traces of a
  failed install;
- `shared.db` — the `shared` scope;
- `models/` — downloaded embedding models;
- `jev-config.json` — settings of the optional Jev adjudication; **it may hold a key**, so never publish it or
  paste it anywhere.

A backup is copying these files while DSH is stopped. Starting over is moving them aside: the plugin
recreates what it needs. The operation journal lives in the same files (the `op_log` table) and is read by
`scripts/check-journal.mjs`.

## Rollback

- Restore the previous `lib/` from `_deploy-backup/<timestamp>/` next to the repository (deployment now copies
  files over the existing ones, so copying back is the rollback; do it with DSH closed);
- or remove the `dsh-engram` block from `cordis.patch.yml` and restart — data files stay in place, nothing is
  deleted.

## Keys

The plugin reads a key from the config or from an environment variable and never writes it into logs, error
messages or diagnostics. Do not put keys into `cordis.patch.yml` if that file lives in a repository — use
`apiKeyEnv` and keep the value in the environment.
