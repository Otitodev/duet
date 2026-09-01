# Contributing to Duet

Thanks for your interest. Pull requests are welcome.

> **For anything substantial, open an issue first.** It is much cheaper to disagree about an
> approach in a comment than in a finished branch.

Duet is a fork of [Avnac](https://github.com/xt42io/avnac), an open source browser design editor.
The canvas — shapes, text, images, dragging, snapping, layers, persistence, export — is the original
authors' work. Duet's contribution is a **WebMCP tool layer** that lets any AI agent operate the same
canvas a person is working on. Most of what you will want to change lives in that layer.

## Before you start

1. Check the open pull requests, in case someone is already on it.
2. Check the open issues before raising a new one.
3. For a larger change, comment on the issue before you start, so the work stays aligned.

## Getting started

```bash
git clone https://github.com/YOUR_USERNAME/duet.git
cd duet/frontend
npm install
npm run dev          # http://localhost:3300
```

**There is no backend.** Duet deleted Avnac's Elysia service, image proxy, background removal and
analytics; `npm run build` emits a static bundle to `frontend/dist` that any static host can serve.
If you find a doc or script that still mentions `backend/`, that is a bug — please fix it.

## Checks

Run all three from `frontend/` before you push:

```bash
npm run lint         # biome
npm test             # vitest
npm run build
```

`npm run lint` reports a number of pre-existing findings inherited from upstream. **Only the change
between your branch and its base is meaningful** — `routeTree.gen.ts` is generated and its count
moves on its own, so compare commit to commit rather than against a remembered number.

`npx biome check --write` is safe. **Do not use `--unsafe`** without reading the diff: it has
rewritten a deliberate type guard (`o !== null && o.visible`) into `o?.visible`, which is not the
same check.

## Branches

Work off **`duet-webmcp`**, which is the development branch.

`main` is fast-forwarded to it automatically by a `post-commit` hook, so it always shows the real
project to anyone landing on the repo. Do not branch from `main` and do not commit to it directly.

```bash
git checkout duet-webmcp
git checkout -b feat/short-description
```

Open pull requests against `duet-webmcp`. Use a semantic prefix (`feat:`, `fix:`, `docs:`).

## Working on the tool layer

This is the part of the codebase with rules of its own, because its consumer is a language model
rather than a person. They are not style preferences; each one is a bug that has already happened.

**Where things live**

| File | Role |
| --- | --- |
| `lib/avnac-webmcp.ts` | Feature detection, the `ok`/`fail` contract, the `guarded` wrapper |
| `lib/avnac-webmcp-tools.ts` | Every tool definition, plus `formatScene` and the shared schemas |
| `lib/avnac-ai-paint.ts` | CSS colour and gradient parsing at the tool boundary |
| `lib/avnac-ai-transforms.ts` | Pure scene transforms, React-free and unit tested |
| `lib/avnac-ai-aliases.ts` | UUID ↔ `text_1` / `rect_2` translation |
| `components/scene-editor/webmcp-host.tsx` | Registration inside the editor |
| `components/webmcp-entry-host.tsx` | The one tool registered on every other route |

**The contract**

- **Errors are returned, never thrown.** A thrown exception tells an agent nothing it can act on.
  Returned text can name what was wrong and list the ids that do exist, so the agent corrects itself
  without another round trip. Use `fail()`, not `throw`.
- **Every write returns the resulting state**, never `"ok"`. A tool that says "done" teaches the
  agent nothing.
- **Never report success for something invisible.** If a value was accepted but cannot render — a
  stroke colour on an object whose width is 0, a canvas background hidden under a full-bleed
  rectangle — say so in the result. Silent no-ops are the single most common defect in this layer.
- **Every schema property needs a `description`.** No bare `{ type: 'string' }`.
- **Descriptions say when *not* to reach for a tool**, and which tool to use instead. That is where
  skilful use actually lives, and it is what gets graded.
- Read-only tools set `annotations.readOnlyHint: true`.
- Shared appearance properties belong in `STYLE_PROPERTIES` and `readStylePatch`, so `update_object`,
  `update_many`, `add_object` and `propose_changes` cannot drift apart in what they support.

**Traps that cost time here before**

- **Register once, read the controller through a ref.** `AiDesignController` is rebuilt on every
  document change, so registering against it directly re-registers the whole surface on every
  keystroke.
- **Never wait on `requestAnimationFrame`.** An agent-driven tab is backgrounded constantly, and rAF
  simply never fires there. `settle()` races it against a `setTimeout` for exactly this reason.
- **Rebuild the alias map on every call.** Aliases derive from document order, so a map held across
  an insert or delete points at the wrong objects.
- **Recompute text height** whenever text, font size, family or spacing changes, via `layoutSceneText`.
  `applyAiPatch` already does; anything bypassing it must too.
- **Load a font before measuring text in it.** Measuring against a fallback face gives the box the
  wrong height, and nothing reports it.
- **`baseObjectFromUnknown` enumerates fields by hand.** Any new field on `SceneObjectBase` must be
  added there too, or it is silently dropped on every save and load.

**Never rename `DB_NAME = 'avnac-editor'` or `AVNAC_STORAGE_KEY`.** Renaming either orphans every
document a user has saved, for no benefit. Internal `avnac-*` identifiers are deliberate: they
corroborate the fork rather than hiding it.

## Testing tools against a real browser

The type checker will not catch the interesting bugs in this layer. Every genuinely serious defect
in this codebase so far compiled cleanly.

Enable `chrome://flags/#enable-webmcp-testing` in Chrome 146 or later, then:

```js
const mc = document.modelContext
const tools = await mc.getTools()
const tool = tools.find(t => t.name === 'get_scene')
const result = JSON.parse(await mc.executeTool(tool, '{}'))
```

> `executeTool(toolObject, argsJsonString)` — the first argument is a **tool object** from
> `getTools()`, not a name, and the second is a **JSON string**, not an object. It returns a JSON
> string. Passing a plain object fails with `Failed to parse input arguments`.

Manual invocation only proves a tool *works*. It cannot tell you whether an agent will ever *choose*
it, which is a different failure with no error anywhere. For that, drive the page with a real client:
the [Model Context Tool Inspector](https://github.com/beaufortfrancois/model-context-tool-inspector)
extension has built-in Gemini integration, and ChatGPT's in-app browser supports WebMCP natively.
**If an agent ignores a tool, fix the description before you touch the code.**

## Pull requests

- Keep each pull request to a single change.
- Say what changed and why. If it affects behaviour or UI, include a screenshot.
- Add tests for pure logic. `lib/avnac-ai-transforms.ts` and `lib/avnac-ai-paint.ts` are React-free
  precisely so they can be tested directly; see `src/__tests__/`.
- Say what you actually verified in a browser, and what you did not.

## Licence

Duet is **AGPL-3.0-only**, inherited from Avnac and unchanged. Contributions are accepted under the
same licence.

Do not modify `LICENSE`, and do not remove the modification notice in the README (AGPL §5a) or the
source link in the app footer, which satisfies §13 for the deployed instance.
