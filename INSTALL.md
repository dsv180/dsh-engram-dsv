# Installing dsh-engram-dsv

Detailed installation guide with the problems we hit ourselves and how to get past them.
A short version lives in [README.en.md](README.en.md); this file is for the cases where
something does not work.
По-русски: [INSTALL.ru.md](INSTALL.ru.md).

**If you are an AI agent installing this:** go through the steps in order, run every command and show
its output to the human. Change nothing except the profile's `cordis.patch.yml`. Never open, print or
copy credentials. If a step fails — report the exact error instead of guessing.

## What you need

- A working **DeepSeek Harness** installation. We built and verified against `0.2.0-rc.2`. Older
  versions are untested and we do not vouch for them.
- **Node.js** 22.19+ or 24+ (that is the plugin's own `engines` requirement).
- Network access **once**, on the first run, to download the embedding model — unless you use a remote
  embedder or accept keyword-only retrieval.
- Verified platform: **Windows**. Linux and macOS have never been run by us. The sources contain no
  operating-system checks at all (`win32` / `darwin` / `linux` / `process.platform` appear nowhere in
  `src` or `scripts`), so there is nothing obviously Windows-only — but that is reading the code, not a
  test. If you try it there, please report what happened.

## Steps

### 1. Get the sources

```bash
git clone https://github.com/dsv180/dsh-engram-dsv.git
cd dsh-engram-dsv
```

### 2. Install dependencies

```bash
pnpm install
```

The package runs a `prepare` step (`scripts/link-peers.mjs`) that links DeepSeek Harness packages as
peers, so it expects the harness to be present on the machine. If pnpm refuses to run the script, allow
it explicitly:

```bash
pnpm --config.verify-deps-before-run=false install
```

### 3. Build

```bash
pnpm bundle
```

This produces `lib/index.js` (the server half) and `lib/client.js` (the memory panel). If `lib/` does
not appear, nothing else will work — fix this step first.

### 4. Put the build into a DSH profile

The plugin must end up inside the profile you use, at
`<profile>/node_modules/@kenz1117/dsh-engram/`. Two ways:

**Preferred — the deployment script.** It copies `lib/` into the profile and moves the previous build
into `_deploy-backup/<timestamp>/` next to the repository, so rollback is a copy back:

```bash
node scripts/deploy-profile.mjs --profile desktop
```

**Alternative — a package.** `pnpm pack` produces `kenz1117-dsh-engram-<version>.tgz`, which the DSH
plugin menu accepts; the command line equivalent is:

```bash
pnpm --dir <profile> add <file>.tgz
```

### 5. Local embeddings

Without this the plugin still works, but only by keywords — and silently, without an error:

```bash
pnpm --dir <profile> add @huggingface/transformers
```

### 6. Enable and configure

Add this block to `<profile>/cordis.patch.yml`:

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

### 7. Restart DSH

The server half of the plugin resolves its language once at startup, so a restart is not optional.

## When something does not work

| Symptom | Cause | What to do |
| --- | --- | --- |
| The plugin does not appear at all | The entry was added to `cordis.yml`, which is always empty | Edit `cordis.patch.yml` in the profile — `cordis.yml` says so itself |
| `pnpm install` fails inside `prepare` / `link-peers.mjs` | DeepSeek Harness packages are not visible as peers | Run the install where DSH is present, or use the flag from step 2 |
| `pnpm bundle` succeeds but nothing changes in DSH | The build was not copied into the profile, or DSH was not restarted | Repeat step 4 and restart |
| Search returns nothing by meaning, only by words | `@huggingface/transformers` is not installed next to the plugin — the fallback is silent | Step 5, then check in the memory panel that the embedder is reported |
| The first search takes a long time | The embedding model is being downloaded (once) | Wait; for a machine without network set `embedder.kind: remote`, or accept keyword-only retrieval |
| Text appears in the wrong language | The server language is fixed when the plugin starts | Fix `language` in the config and restart; `auto` follows the system locale, and a language without a dictionary falls back to English |
| Config load fails with `language must be one of auto\|zh\|en\|ru` | A typo in `language` | Use one of the four listed values |
| Nothing is captured from conversations | `ingest: light` skips short quiet turns by design, and a genuinely empty model answer is journaled as a separate event | Check the operation journal; long substantive turns are what gets captured |
| You are on Windows and a command with embedded JavaScript fails | PowerShell eats quotes and backticks inside one-liners | Write the script to a file and run the file |
| You want to know whether extraction is really running | The prompt itself is not logged | Look at the `ingest-request` entries in the journal: their `maxTokens` shows which build is loaded |

## How to check that it worked

1. After the restart, the memory panel appears in DSH settings.
2. Ask the agent to use `engram_save` for a test fact and then `engram_search` for it — the record
   should come back with its room and placard.
3. `engram_stats` shows the palace: rooms, slot counts, journal size.
4. If the embedder is installed, a search by meaning finds a record whose wording differs from the
   query; if it only matches exact words, step 5 was not done.

## Where the data lives

Everything is a plain SQLite file under the DSH home directory, in `engram/`:

- `user.db` — memories in the `user` scope (shared by all workspaces);
- `project-<hash>.db` — one file per workspace (`project` scope);
- `shared.db` — the `shared` scope;
- `jev-config.json` — configuration of the optional Jev arbitration; **it can contain a key**, so never
  commit it and never paste it anywhere.

Backup is copying those files while DSH is not running. Starting over is moving them away — the plugin
recreates what it needs.

## Rolling back

- Restore the previous `lib/` from `_deploy-backup/<timestamp>/`;
- or remove the `dsh-engram` block from `cordis.patch.yml` and restart — the data files stay where they
  are and nothing is deleted.

## Keys

The plugin reads a key from its configuration or from an environment variable and never writes it to
logs, error texts or diagnostics. Do not put keys into `cordis.patch.yml` if that file is in a
repository — use `apiKeyEnv` and keep the value in the environment.
