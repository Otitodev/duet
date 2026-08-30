/**
 * WebMCP plumbing: feature detection, minimal typings, and the result contract
 * every Duet tool goes through.
 *
 * WebMCP is not in lib.dom yet, so the shapes below are hand-declared against
 * the API as it actually behaves in Chrome 151.
 */

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
  return { content: [{ type: 'text', text }] }
}

/** Guard so a tool bug surfaces as readable text rather than a broken call. */
export function guarded(name: string, tool: WebMcpTool): WebMcpTool {
  return {
    ...tool,
    execute: async args => {
      try {
        return await tool.execute(args ?? {})
      } catch (err) {
        return fail(`${name} failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}
