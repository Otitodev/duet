import { useNavigate } from '@tanstack/react-router'
import { useEffect, useRef } from 'react'

import { getModelContext, guarded, ok, type WebMcpTool } from '../lib/avnac-webmcp'

const EDITOR_PATH = '/create'

/** A tool only the editor registers, so its presence means the editor is up. */
const EDITOR_MARKER = 'get_scene'

/**
 * Waits for the editor's tools to appear in the registry after navigation.
 *
 * `setTimeout`, never `requestAnimationFrame`: an agent-driven tab is
 * backgrounded constantly, and rAF simply never fires there.
 */
async function waitForEditorTools(
  mc: { getTools: () => Promise<unknown[]> },
  timeoutMs: number,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const tools = (await mc.getTools()) as Array<{ name?: unknown }>
    const names = tools
      .map(t => (typeof t.name === 'string' ? t.name : ''))
      .filter(name => name.length > 0)
    if (names.includes(EDITOR_MARKER) || Date.now() >= deadline) return names
    await new Promise(resolve => setTimeout(resolve, 100))
  }
}

function describeToolset(names: string[]): string {
  const design = names.filter(name => name !== 'open_design_editor').sort()
  if (design.length === 0) {
    return 'No design tools appeared. The editor may still be loading -- list the tools again in a moment.'
  }
  return `${design.length} design tools are now available: ${design.join(', ')}. Start with list_templates or get_scene.`
}

/**
 * Registers a single tool, on every route, whose only job is to get an agent
 * into the editor.
 *
 * Duet's fourteen design tools are registered by the editor, which mounts only
 * at `/create`. Anyone sharing this project shares the bare domain, so an agent
 * handed the link lands on the landing page, finds an empty tool registry, and
 * has no way to learn that a tool surface exists one route away. There is no
 * error and no warning -- it simply looks like a site with no WebMCP support.
 *
 * So the front door registers a door handle. Navigation is client side, so the
 * editor's tools join the *same* registry and `ontoolchange` tells the client
 * to re-read it.
 */
export default function WebMcpEntryHost() {
  const navigate = useNavigate()

  // Registration happens once, so the tool reads navigate through a ref rather
  // than closing over the instance it saw on first render.
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])

  useEffect(() => {
    const mc = getModelContext()
    // No WebMCP in this browser: every page stays an ordinary page.
    if (!mc) return

    const tool: WebMcpTool = {
      name: 'open_design_editor',
      description:
        'Open the Duet design editor, which is where this site’s design tools live. ' +
        'Duet is a browser design editor that you and the person operate on one shared canvas. ' +
        'The page you are on now is only the front door and carries no design tools, so call ' +
        'this first whenever you have been given a Duet link and are asked to create, edit or ' +
        'inspect a design. It navigates to the editor and returns the design tools that become ' +
        'available, so no separate discovery step is needed. Safe to call when the editor is ' +
        'already open: it changes nothing and just reports the tools you already have.',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        const alreadyOpen = window.location.pathname === EDITOR_PATH
        if (!alreadyOpen) void navigateRef.current({ to: EDITOR_PATH })

        // Deliberately not unregistered on navigation. Aborting this tool's
        // registration mid-call would be a race against its own reply.
        const names = await waitForEditorTools(mc, alreadyOpen ? 0 : 5000)
        const opening = alreadyOpen
          ? 'The design editor was already open.'
          : 'Opened the design editor.'
        return ok(`${opening} ${describeToolset(names)}`)
      },
    }

    const abort = new AbortController()
    // registerTool settles with an AbortError on unregister. That is the normal
    // teardown path, not a failure.
    void Promise.resolve(mc.registerTool(guarded(tool.name, tool), { signal: abort.signal })).catch(
      () => {},
    )
    return () => abort.abort()
  }, [])

  return null
}
