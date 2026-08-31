/**
 * WebMCP plumbing: feature detection, minimal typings, and the result contract
 * every Duet tool goes through.
 *
 * WebMCP is not in lib.dom yet, so the shapes below are hand-declared against
 * the API as it actually behaves in Chrome 151.
 */

import { recordActivity } from './avnac-activity'

export type WebMcpContent = { type: 'text'; text: string }
export type WebMcpResult = { content: WebMcpContent[] }

export type WebMcpSchema = {
  type: 'object'
  properties: Record<string, unknown>
  required?: string[]
}

export type WebMcpTool = {
  name: string
  description: string
  inputSchema: WebMcpSchema
  annotations?: { readOnlyHint?: boolean }
  /** Chrome parses the JSON argument string and hands `execute` an object. */
  execute: (args: Record<string, unknown>) => Promise<WebMcpResult> | WebMcpResult
}

type ModelContextLike = {
  registerTool: (tool: WebMcpTool, options?: { signal?: AbortSignal }) => unknown
  getTools: () => Promise<unknown[]>
}

/**
 * The getter moved from Navigator to Document in the May 2026 spec draft and
 * `navigator.modelContext` was deprecated in Chrome 150. Verified on Chrome
 * 151: the two are the *same object*, so either surface reaches every client.
 * The fallback is only for browsers that expose one and not the other.
 */
export function getModelContext(): ModelContextLike | null {
  if (typeof document === 'undefined') return null
  const fromDocument = (document as unknown as { modelContext?: ModelContextLike }).modelContext
  if (fromDocument) return fromDocument
  const fromNavigator = (navigator as unknown as { modelContext?: ModelContextLike }).modelContext
  return fromNavigator ?? null
}

export function isWebMcpAvailable(): boolean {
  return getModelContext() !== null
}

/**
 * Results produced by `fail`.
 *
 * Success and failure share a wire shape, so there is no way to tell them apart
 * from the outside. Tracking them here lets the activity log mark a returned
 * failure as failed without putting a non-standard flag on the wire.
 */
const failedResults = new WeakSet<WebMcpResult>()

/** A successful result. Text should describe the resulting state, never "ok". */
export function ok(text: string): WebMcpResult {
  return { content: [{ type: 'text', text }] }
}

/**
 * A failed result.
 *
 * Deliberately a *return*, not a throw. A thrown exception tells the agent
 * nothing it can act on; returned text can explain what was wrong and what to
 * try instead, so the agent self-corrects without another round trip.
 */
export function fail(text: string): WebMcpResult {
  const result: WebMcpResult = { content: [{ type: 'text', text }] }
  failedResults.add(result)
  return result
}

/** Whether a result came from `fail`. */
export function isFailure(result: WebMcpResult): boolean {
  return failedResults.has(result)
}

/**
 * Guard so a tool bug surfaces as readable text rather than a broken call, and
 * record the call.
 *
 * Every tool goes through here, so this is the one place activity needs
 * capturing -- including any tool added later, with no per-tool wiring to
 * forget.
 */
export function guarded(name: string, tool: WebMcpTool): WebMcpTool {
  return {
    ...tool,
    execute: async args => {
      const started = performance.now()
      const safeArgs = (args ?? {}) as Record<string, unknown>
      try {
        const result = await tool.execute(safeArgs)
        recordActivity({
          tool: name,
          args: safeArgs,
          ms: performance.now() - started,
          ok: !isFailure(result),
          result: result.content[0]?.text ?? '',
        })
        return result
      } catch (err) {
        const message = `${name} failed: ${err instanceof Error ? err.message : String(err)}`
        recordActivity({
          tool: name,
          args: safeArgs,
          ms: performance.now() - started,
          ok: false,
          result: message,
        })
        return fail(message)
      }
    },
  }
}
