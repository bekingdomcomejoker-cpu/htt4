# OMEGA Website ↔ MCP Dual-Pipeline Organigram

## Purpose

The website assistant is a model-facing control plane. It can request read-only information from the authenticated OMEGA MCP hub and return that information to the same model before producing an answer. The browser never gives the model direct access to credentials.

```text
┌──────────────────────────────┐
│ Browser / OMEGA Cloud CLI    │
│ selected GPT / Claude / Gemini│
└──────────────┬───────────────┘
               │ chat request + ephemeral bridge context
               ▼
┌──────────────────────────────┐
│ HTT2 server-side assistant   │
│ Forge request + tool loop    │
└──────────────┬───────────────┘
               │ tools/list and tools/call
               ▼
┌──────────────────────────────┐
│ Authenticated OMEGA MCP hub  │
│ tool policy + session        │
└──────────────┬───────────────┘
               │ read-only tool call
               ▼
┌──────────────────────────────┐
│ Termux / connected services  │
│ peers, status, inbox, files  │
└──────────────┬───────────────┘
               │ verified result
               └──────────────► HTT2 tool message
                                  │
                                  ▼
                         selected model final answer
                                  │
                                  ▼
                         browser chat + saved history
```

## Current permissions

The assistant may receive tools whose names indicate read-only behavior, including health, status, snapshot, list, read, get, search, inspect, view, check, info, battery, peers, and tools operations. The assistant lane blocks `termux_exec`, shell/exec operations, inbox writes, file writes/deletes, deployment operations, RouterOS mutation, and other obvious write or command tools.

The visible Terminal and Tools tabs remain the explicit operator path for command execution. A later approval workflow can promote a blocked operation only after showing the exact tool name and arguments to the owner.

## Dual pipeline meaning

A tool call is not silently sent to a second model. The selected model proposes a tool call; HTT2 executes the approved read-only MCP call; the MCP result is appended as a tool message to the same conversation; and the initiating model receives that result and produces the final answer. Termux remains the execution body, while the website remains the user-facing control plane.

## Credentials

The browser’s active hub URL and key are sent only as transient request context to the server-side assistant call and are not stored in chat history. Forge credentials remain server-side. The long-term hardening path is to bind the OMEGA hub credentials as server-side deployment secrets so the browser no longer supplies bridge credentials to the assistant request.

## Large prompts

The assistant accepts up to 120,000 characters per prompt and up to 80 stored context messages. Model output is capped at 8,000 tokens per completion, and the MCP loop is capped at six rounds with at most four tool calls per round. These bounds prevent runaway requests while supporting large pasted documents.
