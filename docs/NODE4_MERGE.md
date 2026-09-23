# OMEGA Operator Node 4

Node 4 is a new, standalone WebDev project. The source repositories `htt`, `htt2`, and `htt3` were used as read-only inputs and were not modified.

## Unified source layout

The active Node 4 website uses the validated HTT3 full-stack runtime at the project root. HTT3 is a direct descendant of HTT2, so its root application includes the Node 2 assistant, conversations, model catalog, MCP inspection, approval-gated Termux execution, exports, and refresh-safe chat behavior, together with the Node 3 mesh, pipeline, model chat, voice, and LORNA relay features.

The original HTT source is merged into the same Node 4 project at root-level paths rather than a `legacy/` directory:

- `htt-original-src/` contains the complete original HTT TanStack application source.
- `hub/`, `console/`, `scripts/`, `attachments/`, `screenshots/`, `public/`, and `AGENTS.md` preserve the original HTT runtime and operational assets.
- `htt-original-package.json` and `htt-original-package-lock.json` preserve the original dependency contract.
- `integrations/lorna3-onlineagent/` preserves the Node 3 online-agent integration.

These are first-class Node 4 source assets. The WebDev root entrypoint remains the single deployable process, and the active UI is the HTT3 OMEGA Operator surface so WebDev can build and serve it reliably.

## Source provenance

| Source | Read-only input commit |
|---|---|
| HTT | `1fb24cdd3864d0ac9857d8e19eb25144525375d7` |
| HTT2 | `efe72082c8a53dcb32354f9a6ae00fbe06a2e62c` |
| HTT3 | `b57fd1706d3171ad5bac24e01ed479d3824cea42` |

## Runtime and security

Node 4 uses the WebDev-managed Node process and its built-in environment variables. Forge credentials remain server-side. Runtime hub and Termux keys remain runtime configuration, not committed source. Mutating Termux tools continue to require the visible approval flow; the assistant lane is read-only except for the explicit approved command path.

## Validation

Node 4 must pass `pnpm check`, `pnpm test`, and `pnpm build`. The final delivery requires a browser smoke check against the Node 4 preview and one WebDev checkpoint at the end of the build, followed by publishing the Node 4 website.
