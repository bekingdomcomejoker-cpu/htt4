# OMEGA Operator — Node 3 Progress

_Last updated: 2026-09-23 UTC_

## Current status

Node 3 is a separate WebDev project cloned from the verified Node 2 implementation. It preserves the OMEGA Operator control-plane UI, the server-side assistant endpoint, model selection, persistent conversations, MCP inspection flow, approval-gated Termux command execution, and the refresh-safe post-approval response handling.

The project is published at `https://omeganode-iulvtxyb.manus.space`.

## Lineage and repository

- **Node 2 source repository:** `bekingdomcomejoker-cpu/htt2`
- **Node 2 fix commit cloned into Node 3:** `efe72082c8a53dcb32354f9a6ae00fbe06a2e62c` (`Fix approved command response refresh`)
- **Node 3 source repository:** private `bekingdomcomejoker-cpu/htt3`
- **Node 3 clone tag:** `node3-checkpoint-2026-09-23`
- **WebDev project:** `OMEGA Operator Node 3` (`omega-node3`)
- **Node 2 was not modified** while creating or repairing Node 3.

## Work completed by previous Manus tasks

The prior work familiarized the project with the split OMEGA architecture: a browser UI, a server-side assistant/LLM endpoint, an OMEGA MCP/Render hub bridge, and a reverse-connected Termux relay. The completed Node 2 feature set included:

- Selectable Manus Forge model catalog for Claude, GPT, and Gemini options.
- Server-side Forge credential handling; credentials are never sent to the browser.
- Persistent browser-scoped conversations using a local client ID.
- Conversation creation, model changes, message loading, and assistant request procedures.
- Cloud CLI model selector, New chat control, saved message history, and refresh-safe status.
- Read-only MCP inspection through the assistant lane.
- Explicit approval-gated Termux command execution; autonomous writes, deletes, inbox mutations, deployment actions, RouterOS mutations, and other destructive tools remain blocked.
- Separate authenticated Terminal and Termux relay surfaces.
- Bounded MCP tool-loop behavior and server-side prompt/history limits.
- Conversation and MCP tests, typechecking, and production-build validation.

## Response-flow fix carried into Node 3

Commit `efe7208` fixes the approval response race in the client. After the operator approves and executes a command, the UI waits for the persisted assistant response to be refetched before rendering it. The stale pre-approval message can no longer overwrite the command result. The prompt is cleared and the busy state resets on both success and failure.

## Node 3 deployment fixes

The first Node 3 publication attempt exposed two production-hosting risks in the inherited server entrypoint:

1. The server scanned for an available port and could choose a port other than the platform-provided `PORT`, which can fail a managed-host health check.
2. Production static serving pointed at `server/_core/public` instead of the Vite output directory `dist/public`.

Node 3 now binds directly to `process.env.PORT || 3000` on `0.0.0.0` and serves production assets from `dist/public`. These changes are in `server/_core/index.ts` and `server/_core/vite.ts`.

## Database repair completed after publication

The Node 3 source already contained the `conversations` and `chatMessages` tables in `drizzle/schema.ts`, plus the migration SQL in `drizzle/0001_slim_obadiah_stane.sql`. The new WebDev database had not yet applied that migration, so the published UI produced two errors:

- A query failure while selecting conversations for the browser client.
- A mutation failure while inserting a new conversation.

The live WebDev database was repaired non-destructively with `CREATE TABLE IF NOT EXISTS` for both `conversations` and `chatMessages`. A follow-up `SHOW TABLES` query confirmed both tables exist. No existing data was deleted or modified.

For any future fresh environment, apply the committed schema using the project migration workflow (`pnpm db:push`) before testing chat persistence. `drizzle-kit generate` only compares/generates migration files; it does not apply them to the database.

## Validation

The final Node 3 source passed:

- `pnpm check` — TypeScript check passed.
- `pnpm test` — 2 test files, **9 tests passed**.
- `pnpm build` — Vite client and bundled production server build passed.

The only build notice is a non-blocking large-client-chunk warning from Vite.

## WebDev checkpoints

- Initial Node 3 bootstrap: `9c9588b5`
- Exact Node 2 clone checkpoint: `354efc41`
- Deployment-fix checkpoint: `a1aae0d3`

## Security and ownership notes

No Forge key, environment file, or credential material is committed. Runtime credentials must remain in WebDev server-side secrets. The GitHub repository is private. Node 2 and its existing deployment were not deleted, overwritten, or republished as part of the Node 3 work.

## Recommended next work

1. Verify a complete chat round trip on the published URL: create a conversation, send a prompt, refresh, and confirm the assistant response remains visible.
2. Add command audit logging so approved Termux executions are reviewable in the interface.
3. Add an explicit command allowlist before enabling additional production command types.
4. Add a deployment smoke test that checks the production port binding, static asset path, database tables, and the conversation create/list procedures.
5. Keep the live schema migration step in the release checklist for every new WebDev environment.

## Known deployment URL

`https://omeganode-iulvtxyb.manus.space`

## Source

Node 3 is maintained in the private repository `bekingdomcomejoker-cpu/htt3`. The public deployment should be treated as the runtime release of the source and checkpoint described above.

## Security note

No Forge key, environment file, or credential material is committed. The GitHub repository is private.


## Node Mesh tab — 2026-09-23 UTC

Added a dedicated **Node Mesh** navigation tab beside Cloud CLI. It presents three responsive side-by-side lanes: `NODE 1 / Omega VPS`, `NODE 2 / Termux device`, and `NODE 3 / Cloud CLI`.

Each lane has a recipient selector, message composer, send action, node status badge, and recent traffic list. Messages use the authenticated OMEGA hub’s existing `inbox_post` and `inbox_read` MCP tools rather than mock or browser-only state. The mesh refreshes automatically every seven seconds and supports Ctrl/Cmd + Enter to send. Default routing addresses are `vps`, `termux`, and `cloud`; if the hub advertises different peer IDs, those addresses must be adjusted in the bridge contract.

Validation after the Node Mesh change: TypeScript check passed, **9 Vitest tests passed**, and the production build passed. The only build notice remains the non-blocking Vite large-client-chunk warning.

## Node Mesh publication correction — 2026-09-23 UTC

The first Node Mesh checkpoint exposed a publication regression: the live domain returned HTTP 404 even though the local development preview loaded. The cause was an incorrect production static path in `server/_core/vite.ts`; the bundled server resolves production assets from `dist/public` relative to the bundled `dist/index.js`, while the source/dev server uses the source-relative path.

Restored the correct environment-specific path: development uses the source-relative `dist/public` path, and production uses the bundled server’s `public` path. Verified the built production server locally on port 3100: `/` returned HTTP 200 and the OMEGA app marker was present. TypeScript check passed, **9 Vitest tests passed**, and the production build passed. The live domain must be republished from this corrected checkpoint.

## HTT3 Pipeline tab — 2026-09-23 UTC

Integrated the verified `htt3-pipeline-tab.zip` package from Drive. The package SHA-256 matched the supplied value `862f0209c9ed0bab46e2651f57b43a5cbb243f2f6103577d6bc785e202753f7f`.

Added `server/pipeline.ts` for the five-stage Research → Implement → Critique → Revise → Present orchestration, `server/pipelineRouter.ts` for model defaults/catalog and the pipeline mutation, and `client/src/components/PipelineView.tsx` for model selectors, prompt submission, stage trace, tool-call counts, expandable outputs, and final-answer copy. Added the **HTT3 Pipeline** navigation entry beside Cloud CLI and included theme-matched responsive styles in `client/src/index.css`.

Security behavior is preserved: Forge requests remain server-side through the existing runtime environment, the researcher can use the configured bridge only for discovered tools, and command tools are blocked inside the pipeline research stage. The pipeline does not auto-write files, approve commands, deploy, or alter secrets.

Validation completed: TypeScript check passed, **9 Vitest tests passed**, production build passed, and an isolated htt3 dev-server smoke test returned the OMEGA root page successfully. The build retains the existing non-blocking large-client-chunk warning.

## Live pipeline streaming — 2026-09-23 UTC

Changed the pipeline from a blocking five-stage mutation to a live job workflow. `pipeline.start` creates an in-memory job and returns immediately; `pipeline.status` exposes the current stage array, final answer, tool-call count, and errors. The UI polls status every 700ms while the job is running, so each stage visibly transitions through pending, running, and done/error while the models execute. The original `pipeline.run` mutation remains available for non-streaming callers.

The streaming implementation passed validation in both the GitHub working tree and the active WebDev project: TypeScript check passed, **9 Vitest tests passed**, and the production build passed.

## Model Chat + browser voice phase 1 — 2026-09-23 UTC

Integrated the supplied `htt3-model-chat-voice.zip` package. The package SHA-256 matched the supplied value `aee17a472637c34c5674c9fe104ab679f46c82c03134c996faa5277ae3665676`.

Model Chat now supports browser-native push-to-talk speech recognition, interim transcript display, spoken assistant bubbles, and a persistent local-storage auto-speak toggle. Voice support is feature-detected: mic controls require browser SpeechRecognition support, while speaker controls require speech synthesis. The UI includes the Chrome/Edge privacy notice and voice cannot bypass the existing Termux command-approval gate. No server routes, secrets, schema changes, or new permissions were added.

Validation completed in both the GitHub working tree and active WebDev project: TypeScript check passed, **9 Vitest tests passed**, and production builds passed. The only build notice remains the non-blocking Vite large-client-chunk warning.

## Model Chat layout and collapsible navigation — 2026-09-23 UTC

Integrated the replacement `htt3-model-chat-voice.zip` package. The package SHA-256 matched the supplied value `4909488ecb873a0b6adca5c594b47150744d0b79f65f0d7907e166b6c566cd72`.

Model Chat now keeps a narrow contacts column on the left and the conversation thread on the right on desktop. The contacts list can collapse to an avatar rail, with its preference saved in local storage. The main operator navigation can also collapse to an icon-only rail, with a persisted local preference. Existing voice controls, chat APIs, Termux approval behavior, and security boundaries remain unchanged. A compatibility override preserves Node 3’s fixed-sidebar layout while applying the supplied collapse behavior.

Validation completed in both the GitHub working tree and active WebDev project: TypeScript check passed, **9 Vitest tests passed**, and production builds passed. The only build notice remains the non-blocking Vite large-client-chunk warning.

## Lorna online-agent adapter and Cloud CLI relay — 2026-09-24 UTC

Integrated the supplied `lorna3-onlineagent.zip` package. The package SHA-256 matched `5e1db5624c8ef7a598116038b5a253001d12a538c3c17171d60248976353d564`. The website Cloud CLI now includes a LORNA ONLINE AGENT panel that queues `@onlineagent <prompt>` messages to the Termux inbox and provides an explicit `lorna2 --node agent --quiet -p "/node agent"` probe action through the existing authenticated Termux tool. The adapter source and installation instructions are included under `integrations/lorna3-onlineagent/`.

The Forge API key remains strictly Termux-side; the public website only relays prompts and never stores or receives the online-agent key. Added shared prompt formatting and regression tests for routing, empty-prompt rejection, and the Lorna probe command. Termux installation still requires the connected phone workspace and its local environment variables.

## LORNA 3 TUI dropdown and online-agent route — 2026-09-24 UTC

Repaired the phone-side LORNA 3 Termux TUI so the route palette and Tab-completion dropdown expose both `@onlineagent` and its `@oa` alias. The TUI route executor now forwards those aliases directly to the LORNA 3 dispatcher and adds the standalone `omega-termux-lorna/lorna3` root to `sys.path`, allowing the dispatcher’s sibling `config` package to resolve correctly.

Verification on the connected phone passed with `DROPDOWN_ROUTES=['@onlineagent', '@oa']`, matching completion results for both aliases, and an interactive `lorna3` test returned `l3-tui-oa-ok`. LORNA 2 was not modified by this repair and continues to work through `/node onlineagent`. No credential material was committed.

The reproducible phone-side instructions are documented in `integrations/lorna3-onlineagent/LORNA3_TUI_ROUTE_PATCH.md`; the existing adapter installation guide now references the TUI step.

## LORNA 3 launcher credential loading — 2026-09-24 UTC

Resolved the remaining standalone `lorna3` HTTP 403: the launcher was not sourcing the phone-local `~/.online_agent_env`, although manually sourced diagnostic sessions succeeded. The launcher now loads that file before starting the TUI. A real `~/bin/lorna3` session was verified with `@oa Reply with exactly: l3-launcher-env-ok`, returning the expected response. Credentials remain phone-local and are not committed.

## Node 4 online-agent MCP tool loop — 2026-09-24 UTC

Added the bounded Forge tool loop to the phone-side `online_agent.py` adapter and included the matching authenticated `mcp_client.py` in `integrations/lorna3-onlineagent/`. The adapter initializes the local streamable-HTTP MCP bridge, publishes its discovered schemas as OpenAI-compatible function tools, executes at most four rounds, prevents repeated calls, and falls back to plain Forge chat when the bridge is unavailable. `/node agent` was not modified.

Because the existing LORNA 2 `/node onlineagent` route forwards to the LORNA 3 `lorna3_route` bridge handler, the same adapter now serves both LORNA 2 and LORNA 3 without duplicating or replacing the local agent implementation. The phone’s local MCP catalog was independently confirmed to expose `battery_status` and `connector_health`.

End-to-end read-only verification passed on the connected phone for both routes. LORNA 3 `@oa` invoked `battery_status` and returned a live JSON record showing 29% and charging; a subsequent LORNA 2 `/node onlineagent` test invoked the same tool and returned a live record showing 30% and charging. The route aliases, launcher credential loading, and MCP authentication all passed. No credential material was committed.

The Node 4 adapter package now documents the two-file installation, phone-local token loading, bounded loop behavior, and exact LORNA 2/LORNA 3 verification commands in `integrations/lorna3-onlineagent/INSTALL.md`.

## Persistent chat memory — 2026-09-24 UTC

Added durable, browser-scoped operator memory to Model Chat. The new `chatMemories` table stores up to 2,000 characters per memory against the existing browser client ID; the UI can save, list, and delete entries from the Model Chat sidebar. Before each assistant request, the server loads the client’s saved memories and injects a bounded, clearly labeled memory context into the server-side system prompt. Existing conversation history and MCP approval behavior remain unchanged.

The migration was applied non-destructively to the Node 4 database with `CREATE TABLE IF NOT EXISTS`. TypeScript validation passed, all **14 Vitest tests passed**, the production build passed, and the Python online-agent adapter checks passed. No memory contents or credentials were added to source control.

## Termux shared-memory repair — 2026-09-24 UTC

The Termux online-agent route is now linked to LORNA’s existing `~/.lorna_v2/facts.json` backend through three supervised MCP bridge tools: `lorna_remember`, `lorna_memory_context`, and `lorna_forget`. The online-agent system prompt requires those tools for explicit memory operations. After fixing one `_Path` import alias in the bridge helper and restarting `omega-mcp`, the real LORNA 2 flow saved and recalled the flashlight preference successfully; the fact is present in the canonical facts file. The local `/node agent` route remains untouched.

## Online flashlight follow-up repair — 2026-09-24 UTC

The online-agent adapter now retains a bounded short-term conversation window, allowing `turn it off` to resolve the immediately preceding flashlight-on request. It also normalizes common misspellings such as `flashloght` and routes flashlight commands directly to a new bounded `flashlight_control` MCP bridge tool backed by `termux-torch`, avoiding the slow LORNA3 language-model route for this deterministic device action. A real LORNA 2 sequence returned four successful results for typo-on, `off`, typo-on, and `turn it off`. The separate `/node agent` Ollama error is an independent local-backend availability issue and was not modified.

## Continuation handoff — 2026-09-24 UTC

The complete continuation package is documented in `CONTINUATION_HANDOFF.md`. It records why Node 4 was created, the capabilities consolidated from the earlier repositories, the website and database state, the LORNA 2/LORNA 3 Online Agent wiring, the shared LORNA facts-memory integration, the deterministic flashlight repair, the separate Ollama limitation for `/node agent`, the key files, and the verification commands. The existing Node 4 website and private `htt4` repository are the continuation targets; no new website is required.

The latest pushed commit is `3fb9ed73e2c189862c1f16b262293d4df231f2b7953b`. The repository is clean after the push. The latest validation passed TypeScript checks, all **15 Vitest tests**, production build checks, and Python adapter syntax checks. The connected phone passed the real LORNA 2 flashlight follow-up sequence and shared-memory save/recall test.

## Server-side credential backup — 2026-09-24 UTC

At the operator’s explicit request, the three available Node 4 server-side runtime values—`BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, and `JWT_SECRET`—were copied to Termux at `~/.omega-node4-server.env` with mode `600`. Verification checked only the variable names and value lengths; no secret values were printed, committed, or added to this document. The continuation handoff records the secure file location and sourcing command.

## Exact instructions for the next conversation — 2026-09-24 UTC

### 1. Continue the existing website

Do not initialize a new website, create a new WebDev project, or create a new repository. Continue with the existing project at `/home/ubuntu/omega-node4`, the existing private repository `bekingdomcomejoker-cpu/htt4`, and the existing deployment at `https://omeganode-djexaqht.manus.space`. Read `CONTINUATION_HANDOFF.md` before making changes.

The next session should begin with this instruction: “Continue OMEGA Operator Node 4 from `/home/ubuntu/omega-node4`. Do not create a new website. Read `PROGRESS.md` and `CONTINUATION_HANDOFF.md`, inspect the current Git status, and continue from the latest pushed commit.”

### 2. Check the source state

Run:

```bash
cd /home/ubuntu/omega-node4
git status --short --branch
git log --oneline -5
git remote -v
```

The expected branch is `main`, the remote is the private `htt4` repository, and the tree should be clean. The latest documentation commit is `7e884d6cd7ce5b862fed93ae471ade4983e625ce`.

### 3. Load server-side credentials only when needed

The confirmed server-side values are stored on Termux, not in GitHub or this file. On the phone, load them with:

```bash
set -a
. "$HOME/.omega-node4-server.env"
set +a
test -n "$BUILT_IN_FORGE_API_URL"
test -n "$BUILT_IN_FORGE_API_KEY"
test -n "$JWT_SECRET"
```

The file must remain mode `600`. Do not print the values, paste them into chat, add them to source control, or place them in the website frontend.

### 4. Check the Termux services

Run on Termux:

```bash
sv status omega-mcp
test -s "$HOME/.config/omega/mcp.token"
test -s "$HOME/.online_agent_env"
python3 -m py_compile "$HOME/omega_mcp_bridge.py"
python3 -m py_compile "$HOME/omega-termux-lorna/lorna3/adapters/online_agent.py"
```

The existing phone integrations are `/node onlineagent` for LORNA 2 and `@onlineagent` or `@oa` for LORNA 3. The local `/node agent` route must not be changed while working on the Online Agent. If `/node agent` reports that Ollama is unavailable, diagnose Ollama separately.

### 5. Run the known-good Online Agent tests

Use LORNA 2 to verify MCP, memory, and follow-up context:

```text
/node onlineagent
Remember exactly this preference: when I say turn it off after turning on the flashlight, turn the flashlight off.
What do you remember about turning it off after the flashlight is on?
turn rhe flashloght on
off
```

Expected results are a successful memory save, a successful memory recall, `Flashlight turned on.`, and `Flashlight turned off.`. Confirm the durable fact without printing secrets:

```bash
grep -n flashlight "$HOME/.lorna_v2/facts.json"
```

### 6. Validate and publish changes

For source changes, run:

```bash
cd /home/ubuntu/omega-node4
pnpm check
pnpm test
pnpm build
git diff --check
```

Remove generated `integrations/lorna3-onlineagent/__pycache__/` files before committing. Commit the intended source and documentation changes, push `main` to the existing `github` remote, confirm `git status --short --branch` is clean, and record the new commit here. Use the existing WebDev checkpoint workflow when handing code to the website preview; do not create another project.

## Continuation validation and Online Agent regression hardening — 2026-09-24 UTC

The existing private `htt4` repository was restored into a fresh continuation sandbox at the prescribed `/home/ubuntu/omega-node4` location without creating a new website or repository. The deployed Node 4 gateway at `https://omeganode-djexaqht.manus.space` returned the expected secure OMEGA Operator bridge landing page.

The source validation initially identified a reproducibility problem: the assistant unit tests relied on deployment-only Forge environment variables, which are intentionally not present in a clean source checkout. The tests now mock only the Forge transport configuration with non-secret fixture values. This keeps the production guard intact while allowing the suite to validate request, MCP, approval, and upstream-error behavior offline.

The phone-side adapter now normalizes the observed `flashloght` typo in its retained conversation history as well as in the current message. Consequently, `turn it off` resolves correctly after a typo-based flashlight-on request. New offline Python regression coverage verifies that a memory request calls `lorna_remember` and that the typo-on / follow-up-off flow invokes `flashlight_control` with `on` and then `off`. The tests use in-process LORNA and MCP stand-ins; no phone connection, token, or Forge credential is required.

Validation passed: `pnpm check`, `pnpm test` (**15 Vitest tests**), `python3 -m unittest integrations/lorna3-onlineagent/test_online_agent.py` (**2 tests**), `pnpm build`, Python syntax checks, and `git diff --check`. The build retains only the pre-existing Vite analytics-placeholder and large-chunk warnings. The verified source repair is commit `023f1239056abb9642ceb76edc56f1d03b502889` (`Harden Online Agent regression coverage`).

## Cloud CLI model rotation and token accounting — 2026-09-24 UTC

Added `claude-opus-4-6` to the shared Cloud CLI model catalog. The other models returned by the current live Forge catalog—`gpt-5-nano`, `gpt-5-mini`, `gpt-5`, `gpt-5.5`, `gemini-3-flash-preview`, and `gemini-3.1-pro-preview`—were already present in the application list. Cloud CLI now has ten selectable model entries in total.

Cloud CLI assistant responses now carry an aggregated usage record across the complete Forge/MCP tool loop: prompt tokens, completion tokens, total tokens, and number of Forge requests. The browser persists cumulative totals in local storage and displays total tokens and request count in the Model Chat header. This is intentionally browser-scoped accounting; it does not claim to be an account-wide Forge billing ledger.

Added a persisted **Rotate models** switch. When enabled, each new prompt advances round-robin through the ten model entries while preserving the existing conversation, tool approval, memory, and voice flows. The actual responding model remains visible on each assistant bubble through the returned model field. Validation passed after the change: TypeScript check, all **15 Vitest tests**, **2** Online Agent Python regressions, and production build.

## Local Ollama model — 2026-09-24 UTC

Installed Ollama `0.34.3` in the current sandbox and pulled `qwen2.5:7b` (4.7 GB download; approximately 5.1 GB loaded in memory). The local API smoke test returned `LOCAL_7B_OK`. The model runs CPU-only in this environment; the verified response took approximately 17.5 seconds including model load.

Added an optional `Local Qwen2.5 7B` model entry to the existing website source. When the website server runs on the same host as Ollama, selecting this model sends OpenAI-compatible requests to `LOCAL_LLM_API_URL` (default `http://127.0.0.1:11434`) using model `qwen2.5:7b`; `LOCAL_LLM_API_KEY` is optional. Forge remains the default provider for all existing models. The local provider is not reachable from the existing public WebDev deployment unless the deployed server is colocated with Ollama or given a secure private network path.

## Cloud Local CLI tab — 2026-09-24 UTC

Added a dedicated **Cloud Local CLI** navigation tab to the existing OMEGA Operator interface. It reuses the authenticated Model Chat surface but filters the catalog to the local `Local Qwen2.5 7B` provider, automatically opens that local conversation, and labels the view as private Ollama-hosted inference. The regular **Model Chat** tab continues to show the complete Forge plus local model catalog, including Qwen in rotation mode.

Validation passed after the UI change: TypeScript check, all **16 Vitest tests**, **2** Online Agent Python regressions, production build, and `git diff --check`.

## Sandbox Shell reverse link and Termux URL repair — 2026-09-24 UTC

Kept the work on the existing private `bekingdomcomejoker-cpu/htt4` repository and the existing `htt4-webdev` WebDev project; no `htt5` repository or second website was created. The website now includes a **Sandbox Shell** tab backed by the current session’s authenticated sandbox bridge. The bridge provides a health endpoint, bounded shell execution, and SSE output for live stdout/stderr chunks. The browser keeps the last 30 commands in session-local history and can restore any previous command without sending credentials to the client-side bridge.

The Termux hub connector was repaired in `hub/vps.mjs`. Absolute `http(s)` MCP base URLs are normalized by removing an optional trailing `/mcp`; malformed relative values such as `/mcp` are rejected with an actionable configuration error instead of producing `Failed to parse URL from /mcp`. This is the source-level fix for the current `termuxLastError` observed in the canonical hub.

A persistent cloud node could not be attached in this session because no cloud-computer attachment or management connector is present. The Sandbox Shell therefore remains explicitly session-scoped and temporary; the existing website and repository remain the durable artifacts. Attaching a persistent node later should replace `SANDBOX_SHELL_URL` and `SANDBOX_SHELL_KEY` with the persistent node’s authenticated endpoint without creating a new site.

Validation passed: `pnpm check`, `pnpm test` (**19 Vitest tests**), the live sandbox credential test, `python3 -m unittest integrations/lorna3-onlineagent/test_online_agent.py` (**2 tests**), `pnpm build`, `git diff --check`, and `node --check hub/vps.mjs`. The SSE bridge smoke test returned separate stdout, stderr, and completion events.

The next source publication will push these changes to the existing `htt4` `main` branch and use the existing WebDev checkpoint workflow.

## Follow-up release publication — 2026-09-24 UTC

The follow-up source release was pushed to the existing private `htt4` repository on `main` as commit `f278a5f` (`Add streamed sandbox shell and repair Termux bridge`). The existing WebDev project checkpoint is `fc53f21f`. The working tree was clean immediately after the push; this entry records the final publication metadata for continuation.

## Canonical hub deployment repair — 2026-09-24 UTC

The Termux URL failure was traced to the separate private canonical-hub repository `bekingdomcomejoker-cpu/htt`, not the `htt4` website repository. The same normalization repair was applied to `htt/hub/vps.mjs`: absolute `http(s)` URLs are accepted with an optional `/mcp` suffix, while malformed relative values are rejected with a clear error. The canonical hub fix passed `node --check` and `git diff --check`, then was pushed to `htt` `main` as commit `fdf2414` (`Fix Termux MCP URL normalization`). Render’s repository configuration has `autoDeploy: true`, so the deployment should roll forward from that commit.

The existing `htt4` website remains on the existing WebDev project and existing private `htt4` repository. No `htt5` repository or second site was created. The current session still has no attached persistent cloud computer (`persistent_vms` is absent and no computer connector is configured), so the Sandbox Shell remains temporary. To make it persistent, attach the already-purchased cloud computer through the computer control in the Manus session, then configure its authenticated endpoint in the existing WebDev secrets; do not create another website.
