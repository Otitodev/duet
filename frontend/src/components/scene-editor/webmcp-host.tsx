import { useEffect, useRef } from 'react'

import type { AiDesignController } from '../../lib/avnac-ai-controller'
import { getModelContext } from '../../lib/avnac-webmcp'
import { buildDuetWebmcpTools } from '../../lib/avnac-webmcp-tools'
import { useAiController } from './ai-controller-context'

/**
 * Registers Duet's WebMCP tools for the lifetime of the editor. Renders
 * nothing. Must be mounted inside `AiControllerProvider`.
 */
export function WebMcpHost() {
  const controller = useAiController()

  // The controller is a fresh object on every document change, so tools read
  // it through this ref instead of closing over it.
  const controllerRef = useRef<AiDesignController | null>(controller)
  useEffect(() => {
    controllerRef.current = controller
  }, [controller])

  useEffect(() => {
    const mc = getModelContext()
    // No WebMCP in this browser: the page stays an ordinary editor and the
    // banner explains why. Never throw here.
    if (!mc) return

    const abort = new AbortController()
    for (const tool of buildDuetWebmcpTools(controllerRef)) {
      // registerTool settles with an AbortError once the signal fires. That is
      // the normal unregister path, not a failure, so swallow it -- otherwise
      // every unmount logs one unhandled rejection per tool.
      void Promise.resolve(mc.registerTool(tool, { signal: abort.signal })).catch(() => {})
    }
    return () => abort.abort()
    // Registered exactly once. Depending on `controller` here would
    // re-register the whole surface on every edit.
  }, [])

  return null
}
