# OMEGA Operator Node 4 — Continuation Handoff

_Last updated: 2026-09-24 UTC_

## Continuation rule

Continue from the existing **OMEGA Operator Node 4** project. Do not create a new website or a new repository. The active project is `omega-node4`; its private GitHub repository is `bekingdomcomejoker-cpu/htt4`.

The latest pushed source commit is `3fb9ed73e2c189862c1f16b262293d4df231f2b7953b` (`Fix online flashlight follow-ups`). The working tree is clean. The earlier WebDev checkpoint is `dee4b4e4`; later Termux adapter and documentation changes are in GitHub commits `3cd5927`, `5369527`, and `3fb9ed7`.

## Why Node 4 was created

The earlier `htt`, `htt2`, and `htt3` codebases had to be consolidated because the required capabilities were split across versions. Node 4 contains the active full-stack application plus the preserved prior source assets. The original repositories were not modified.

The two major missing areas that motivated the consolidation were:

1. **A complete operator control plane.** Node 4 combines the validated chat, Cloud CLI, MCP inspection, approval-gated Termux execution, operator-session persistence, Node Mesh, pipeline, model chat, and voice features in one website.
2. **A reliable Online Agent on Termux.** LORNA 2 and LORNA 3 now use the Forge-backed adapter with the authenticated local MCP catalog, while the existing local `/node agent` route remains separate and unchanged.

## Node 4 website capabilities

The website is a React 19 and Tailwind 4 frontend backed by Express, tRPC, Drizzle, and MySQL. It includes model chat with persistent browser-scoped conversations, selectable Forge models, voice input and spoken replies, the Cloud CLI relay, Node Mesh lanes, the HTT3 pipeline, MCP inspection, and explicit approval before Termux command execution.

Operator sessions are persisted securely in the browser session flow. The website never receives or stores the Termux Forge key. The deployed database contains the original `conversations` and `chatMessages` tables plus the new `chatMemories` table.

Persistent chat memory is separate from the phone’s LORNA memory. Website memories are stored by browser client ID, can be saved/listed/deleted in Model Chat, and are injected into the server-side assistant prompt with a bounded context. Phone memory uses LORNA’s existing `~/.lorna_v2/facts.json` backend.

The confirmed Node 4 server-side runtime values are also backed up locally on Termux at `~/.omega-node4-server.env` with file mode `600`. The file contains `BUILT_IN_FORGE_API_URL`, `BUILT_IN_FORGE_API_KEY`, and `JWT_SECRET`. It is not committed, printed, or included in this handoff. Load it only when a future Termux maintenance task explicitly needs the server-side values:

```bash
set -a
. "$HOME/.omega-node4-server.env"
set +a
```

## Termux integration status

The Termux bridge is supervised by `omega-mcp` and exposes an authenticated streamable HTTP MCP catalog. The Online Agent adapter initializes that catalog, publishes its schemas to Forge, runs a bounded tool loop, prevents repeated tool calls, and falls back to ordinary Forge chat if the bridge is unavailable.

LORNA 2 uses `/node onlineagent`. LORNA 3 uses `@onlineagent` or `@oa`. The existing `/node agent` route was not changed.

The Online Agent is linked to LORNA’s existing memory implementation through these bridge tools:

- `lorna_remember` saves a fact to `~/.lorna_v2/facts.json`.
- `lorna_memory_context` reads pinned facts and recent LORNA experience.
- `lorna_forget` removes a named fact.

The bridge also exposes `flashlight_control`, backed by `termux-torch`, for deterministic flashlight actions. The adapter keeps a bounded short-term conversation window, so a follow-up such as `turn it off` can resolve the immediately preceding flashlight action. It normalizes the observed typo `flashloght`.

The verified LORNA 2 sequence is:

```text
/node onlineagent
turn rhe flashloght on
off
turn rhe flashloght on
turn it off
```

All four commands returned successful flashlight results. The shared-memory verification also succeeded: LORNA 2 saved the flashlight preference and recalled it from `~/.lorna_v2/facts.json`.

## Important known distinction

If `/node agent` reports that it cannot connect to Ollama, that is a local-agent backend availability issue. It is not an Online Agent MCP failure. Do not modify `/node agent` while repairing the Forge-backed Online Agent. Check that Ollama is installed, running, and reachable on the phone if local-agent work is requested.

## Key files

| File | Purpose |
|---|---|
| `/home/ubuntu/omega-node4/PROGRESS.md` | Project history and validation record |
| `/home/ubuntu/omega-node4/CONTINUATION_HANDOFF.md` | This next-conversation handoff |
| `/home/ubuntu/omega-node4/integrations/lorna3-onlineagent/online_agent.py` | Forge adapter with MCP loop, memory instructions, short-term context, and flashlight handling |
| `/home/ubuntu/omega-node4/integrations/lorna3-onlineagent/mcp_client.py` | Authenticated local MCP client |
| `/home/ubuntu/omega-node4/integrations/lorna3-onlineagent/INSTALL.md` | Termux installation and verification instructions |
| `/home/ubuntu/omega-node4/server/assistant.ts` | Server-side Forge assistant and bounded MCP loop |
| `/home/ubuntu/omega-node4/server/routers.ts` | Chat, memory, Cloud CLI, and relay procedures |
| `/home/ubuntu/omega-node4/drizzle/schema.ts` | Database schema, including `chatMemories` |

## Verification commands

From the Node 4 project:

```bash
cd /home/ubuntu/omega-node4
pnpm check
pnpm test
pnpm build
```

The latest repository validation passed TypeScript checks, all 15 Vitest tests, the production build, and Python syntax checks for the adapter and MCP client.

On Termux:

```bash
sv status omega-mcp
python3 -m py_compile "$HOME/omega_mcp_bridge.py"
python3 -m py_compile "$HOME/omega-termux-lorna/lorna3/adapters/online_agent.py"
```

## Safe next work

The next conversation can continue by adding more deterministic device tools, improving memory editing and recall UX, adding explicit Ollama health diagnostics for `/node agent`, or adding tests for the phone bridge. These changes should be made in the existing Node 4 project and then pushed to the existing private `htt4` repository.

## References

[1]: https://github.com/bekingdomcomejoker-cpu/htt4 "Private OMEGA Operator Node 4 repository"
[2]: https://omeganode-djexaqht.manus.space "OMEGA Operator Node 4 deployment"
