# Duet

**Duet is a fork of [Avnac](https://github.com/xt42io/avnac), an open source browser design editor. The original work is by the Avnac authors and remains under AGPL-3.0. Duet's contribution is a WebMCP tool layer that lets any AI agent operate the same canvas a person is working on.**

> **Modification notice (AGPL-3.0 §5a).** This is a modified version of Avnac. Files were changed beginning **30 August 2026**. See [What is new here](#what-is-new-here) for what was added and removed, and the commit history for the full record.

Built for [The WebMCP Challenge](https://webmcp.devpost.com/).

- **Live:** https://duet.otito.site
- **Source:** https://github.com/Otitodev/duet
- **Upstream:** https://github.com/xt42io/avnac

---

## The idea

A design document is a JavaScript object graph plus IndexedDB. There is no API for a server-side MCP to wrap, and until now an agent's only options were guessing at mouse coordinates or scraping the accessibility tree — neither of which understands what a layer is.

WebMCP puts the tool registry inside the page. Tools run in the tab, against live in-memory state, using the application's own code. For a design editor that turns out to matter in one specific way:

**The agent can see what you selected.** Not inferred from the DOM — the actual objects under your cursor, right now. An agent that only *generates* designs could hand you a picture; it could never know you just clicked two things and said "make these bigger."

Nothing is uploaded. The document never leaves the browser.

## What is new here

Avnac already had agent control of its canvas. It worked the only way that was possible before WebMCP: by embedding one specific AI vendor's SDK, which required an account, an API key, and a hosted service in the loop. Only that vendor's agent could drive it, and by the time this fork was taken that integration was paused and unreachable from the UI.

Duet removes that layer entirely and replaces it with an open browser standard. No account, no key, no vendor, no server.

**Added**

- A WebMCP tool layer — fourteen tools registered through `document.modelContext`, plus an entry tool on every other route so an agent handed the bare link can find them
- A template system, so the agent starts from a hand-authored layout instead of composing by coordinate
- Semantic `role` tags on objects (`headline`, `subhead`, `accent`, …) so an agent can address things by meaning rather than position
- Readable object ids (`text_1`, `rect_2`) at the tool boundary, without rewriting any upstream id
- A "WebMCP not detected" banner, so the page explains itself in a browser without support

**Removed**

- The Tambo AI integration and its vendor SDK
- Unsplash, the Elysia backend, background removal, QR codes
- PostHog analytics — it contradicted the claim that nothing leaves your device

## The tool surface

**Reading**

| Tool | What it is for |
| --- | --- |
| `get_scene` | The whole design: canvas, every object, layer order |
| `get_selection` | What the person has selected **right now** |
| `list_templates` | The starting layouts available |
| `describe_layout` | Overlaps, objects outside the frame, near-miss alignment, contrast failures |

**Editing**

| Tool | What it is for |
| --- | --- |
| `apply_template` | Load a layout and return it ready to fill in |
| `add_object` | Add one element on top of what is there |
| `update_object` | Change one object |
| `update_many` | Change many objects in a single call |
| `align_objects` | Align or distribute, in one commit |
| `delete_objects` | Remove objects |
| `resize_canvas` | Change the canvas, reflowing by `scale`, `fit` or `keep_positions` |
| `select_objects` | Highlight objects in the person's editor |

**Asking permission**

| Tool | What it is for |
| --- | --- |
| `propose_changes` | Show a batch of edits as a ghosted preview and wait for a human |
| `check_proposal` | Ask what the person decided, per change, with their note back |

**Getting in**

| Tool | What it is for |
| --- | --- |
| `open_design_editor` | Registered on every route *except* the editor. The design tools mount at `/create`, so an agent given the bare link would otherwise find an empty registry with no hint that a tool surface exists one route away |

Every tool returns readable text describing the resulting state, and every failure returns an explanation rather than throwing — an unknown id comes back with the list of ids that do exist.

## Running it

```bash
cd frontend
npm install
npm run dev      # http://localhost:3300
```

`npm run build` produces a static bundle in `frontend/dist`, deployable to any static host. There is no backend.

### Seeing the tools

The editor works as an ordinary design tool in any browser. To let an agent drive it you need a WebMCP-capable client:

- **ChatGPT's in-app browser** — supports WebMCP with no setup
- **Chrome 146+** — enable `chrome://flags/#enable-webmcp-testing`
- **Claude Code** — via a community WebMCP bridge extension

If none is present the app shows a banner explaining how to enable one. It never breaks; it just stays an ordinary editor.

> The Claude in Chrome extension does **not** natively consume WebMCP at the time of writing ([open feature request](https://github.com/anthropics/claude-code/issues/30645)); it drives pages by screenshot, which is the approach WebMCP exists to replace.

## Development

```bash
npm test         # vitest
npm run lint     # biome
npm run build
```

## Licence

**AGPL-3.0-only**, inherited from Avnac and unchanged.

Because Duet is offered over a network, AGPL §13 applies: anyone interacting with the deployed instance is entitled to its source, which is linked from the app footer and lives at https://github.com/Otitodev/duet.

Upstream Avnac remains © its authors. Duet's additions are offered under the same licence.
