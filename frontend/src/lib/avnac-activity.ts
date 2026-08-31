/**
 * A record of every tool call the agent makes.
 *
 * This is the evidence that the WebMCP layer is real. Watching a flyer appear
 * proves nothing on its own -- a canned animation looks identical. A list of
 * calls with their actual arguments is what makes the difference visible, so
 * this is treated as a graded surface rather than a debug aid.
 *
 * Same singleton-plus-useSyncExternalStore shape as avnac-proposals.
 */

export type ActivityEntry = {
  id: number
  tool: string
  /** The arguments as the agent sent them. These are the point -- show them. */
  args: Record<string, unknown>
  at: number
  ms: number
  ok: boolean
  /** First line of the result, truncated. Full get_scene output would drown it. */
  preview: string
}

/** Enough to scroll back through a whole demo without growing unbounded. */
const MAX_ENTRIES = 200
const PREVIEW_LIMIT = 140

let entries: ActivityEntry[] = []
let dropped = 0
let sequence = 0
const subscribers = new Set<() => void>()

function emit() {
  for (const fn of subscribers) fn()
}

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** Newest first. Stable reference between changes, as the hook requires. */
export function getSnapshot(): ActivityEntry[] {
  return entries
}

/** How many entries fell off the end of the buffer. */
export function getDroppedCount(): number {
  return dropped
}

export function hasActivity(): boolean {
  return entries.length > 0
}

function firstLine(text: string): string {
  const line = text.split('\n').find(l => l.trim().length > 0) ?? ''
  return line.length > PREVIEW_LIMIT ? `${line.slice(0, PREVIEW_LIMIT - 1)}…` : line
}

export function recordActivity(input: {
  tool: string
  args: Record<string, unknown>
  ms: number
  ok: boolean
  result: string
}): void {
  sequence += 1
  const entry: ActivityEntry = {
    id: sequence,
    tool: input.tool,
    args: input.args,
    at: Date.now(),
    ms: Math.round(input.ms),
    ok: input.ok,
    preview: firstLine(input.result),
  }
  const next = [entry, ...entries]
  if (next.length > MAX_ENTRIES) {
    dropped += next.length - MAX_ENTRIES
    next.length = MAX_ENTRIES
  }
  entries = next
  emit()
}

export function resetActivity(): void {
  entries = []
  dropped = 0
  emit()
}
