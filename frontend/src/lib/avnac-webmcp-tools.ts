/**
 * Duet's WebMCP tool surface.
 *
 * Tools are built from a `MutableRefObject<AiDesignController | null>` rather
 * than the controller itself: the controller is rebuilt on every document
 * change, so closing over it directly would leave tools reading a stale scene.
 * Registration happens once; each `execute` reads the ref at call time.
 */

import type { MutableRefObject } from 'react'
import {
  type AliasMap,
  aliasFor,
  buildAliasMap,
  resolveAlias,
  unknownIdMessage,
} from './avnac-ai-aliases'
import type { AiCanvasInfo, AiDesignController, AiObjectSummary } from './avnac-ai-controller'
import { fail, guarded, ok, type WebMcpTool } from './avnac-webmcp'

type ControllerRef = MutableRefObject<AiDesignController | null>

type Scene = { canvas: AiCanvasInfo; map: AliasMap }

function readScene(ref: ControllerRef): Scene | null {
  const canvas = ref.current?.getCanvas()
  if (!canvas) return null
  // AiObjectSummary carries `kind`; the alias map wants `type`.
  const map = buildAliasMap(canvas.objects.map(o => ({ id: o.id, type: o.kind })))
  return { canvas, map }
}

const NOT_READY = 'The editor is not ready yet. Wait a moment and try again.'

/** One object as a single scannable line. */
function objectRow(map: AliasMap, o: AiObjectSummary, showRole: boolean): string {
  const alias = aliasFor(map, o.id).padEnd(9)
  const role = showRole ? (o.role ?? '-').padEnd(13) : ''
  const pos = `${Math.round(o.left)},${Math.round(o.top)}`.padEnd(10)
  const size = `${Math.round(o.width)}x${Math.round(o.height)}`.padEnd(11)
  const bits: string[] = []
  if (o.fontSize !== null) bits.push(`${Math.round(o.fontSize)}px`)
  if (o.fill) bits.push(`fill ${o.fill}`)
  if (o.stroke && o.stroke !== 'transparent') bits.push(`stroke ${o.stroke}`)
  if (o.opacity < 1) bits.push(`opacity ${o.opacity.toFixed(2)}`)
  if (o.text) bits.push(`"${o.text.length > 60 ? `${o.text.slice(0, 57)}...` : o.text}"`)
  return `  ${alias} ${role}${pos} ${size} ${bits.join('  ')}`.trimEnd()
}

function formatScene({ canvas, map }: Scene): string {
  if (canvas.objects.length === 0) {
    return `Canvas ${canvas.width}x${canvas.height} - background ${canvas.background ?? 'none'}. The canvas is empty.`
  }
  const showRole = canvas.objects.some(o => o.role)
  const head =
    `Canvas ${canvas.width}x${canvas.height} - background ${canvas.background ?? 'none'} - ` +
    `${canvas.objects.length} object(s), listed back to front (the last one is on top)`
  return [head, '', ...canvas.objects.map(o => objectRow(map, o, showRole))].join('\n')
}

export function buildDuetWebmcpTools(ref: ControllerRef): WebMcpTool[] {
  const tools: WebMcpTool[] = [
    {
      name: 'get_scene',
      description:
        'Read the entire design: canvas size, background colour, and every object with its id, ' +
        'position, size, styling and layer order. Call this before making any change, so you know ' +
        'what exists and which ids to use. Objects are listed back to front, so the last one is on ' +
        'top. This is the only way to see the design - the canvas is not readable from the page HTML, ' +
        'so do not try to inspect the DOM.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      annotations: { readOnlyHint: true },
      execute: () => {
        const scene = readScene(ref)
        return scene ? ok(formatScene(scene)) : fail(NOT_READY)
      },
    },

    {
      name: 'get_selection',
      description:
        'Return the objects the person currently has selected in their editor, right now. Use this ' +
        'whenever they say "this", "these", "the selected one", or refer to something without naming ' +
        'it. This is their live cursor selection, shared with you as they work - it is not a guess, ' +
        'and it is the one thing you could not obtain by reading the page.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      annotations: { readOnlyHint: true },
      execute: () => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        const ids = ref.current?.getSelection() ?? []
        if (ids.length === 0) {
          return ok('Nothing is selected. The person has not clicked on any object.')
        }
        const chosen = scene.canvas.objects.filter(o => ids.includes(o.id))
        const showRole = chosen.some(o => o.role)
        return ok(
          [
            `${chosen.length} object(s) selected:`,
            '',
            ...chosen.map(o => objectRow(scene.map, o, showRole)),
          ].join('\n'),
        )
      },
    },

    {
      name: 'select_objects',
      description:
        "Select objects in the person's editor so they can see exactly which ones you mean. They " +
        'light up on screen just as if the person had clicked them. Use this to confirm you have ' +
        'understood before changing anything, or to point at the objects you are about to discuss. ' +
        'This only changes what is highlighted - it never alters the design itself, so it is always ' +
        'safe. Give at least one filter; they combine, so passing both type and role selects only ' +
        'objects matching both.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Object ids to select, e.g. ["text_1", "rect_2"], exactly as returned by get_scene.',
          },
          type: {
            type: 'string',
            description:
              'Select every object of this kind: text, rect, ellipse, image, line, icon, group.',
          },
          role: {
            type: 'string',
            description:
              'Select every object filling this template slot: headline, subhead, body, accent, ' +
              'image-slot, background.',
          },
          text_contains: {
            type: 'string',
            description:
              'Select text objects whose content contains this phrase. Case insensitive.',
          },
        },
        required: [],
      },
      execute: args => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        const { canvas, map } = scene
        const ids = Array.isArray(args.ids) ? (args.ids as string[]) : null
        const type = typeof args.type === 'string' ? args.type.toLowerCase() : null
        const role = typeof args.role === 'string' ? args.role.toLowerCase() : null
        const phrase =
          typeof args.text_contains === 'string' ? args.text_contains.toLowerCase() : null

        if (!ids && !type && !role && !phrase) {
          return fail(
            'Give at least one of: ids, type, role, or text_contains. ' +
              `Objects available: ${map.aliases.join(', ') || 'none, the canvas is empty'}.`,
          )
        }

        let matched = canvas.objects
        if (ids) {
          const wanted = new Set(
            ids.map(v => resolveAlias(map, v)).filter((v): v is string => v !== null),
          )
          const missing = ids.filter(v => resolveAlias(map, v) === null)
          if (missing.length > 0) {
            return fail(unknownIdMessage(map, missing.join(', ')))
          }
          matched = matched.filter(o => wanted.has(o.id))
        }
        if (type) matched = matched.filter(o => o.kind.toLowerCase() === type)
        if (role) matched = matched.filter(o => (o.role ?? '').toLowerCase() === role)
        if (phrase) matched = matched.filter(o => (o.text ?? '').toLowerCase().includes(phrase))

        if (matched.length === 0) {
          return ok(
            `Nothing matched, so the selection is unchanged. ` +
              `The canvas holds: ${map.aliases.join(', ') || 'nothing'}.`,
          )
        }
        ref.current?.selectObjects(matched.map(o => o.id))
        const showRole = matched.some(o => o.role)
        return ok(
          [
            `Selected ${matched.length} object(s); they are now highlighted on the person's screen:`,
            '',
            ...matched.map(o => objectRow(map, o, showRole)),
          ].join('\n'),
        )
      },
    },

    {
      name: 'update_object',
      description:
        'Change one or more properties of a single object: its position, size, colour, text ' +
        'content, font size, opacity, rotation, or semantic role. Call get_scene or get_selection ' +
        'first so you know which id you mean. Text objects re-measure their own height when the ' +
        'text or font size changes, so you do not need to adjust height yourself.',
      inputSchema: {
        type: 'object',
        properties: {
          id: {
            type: 'string',
            description: 'The object to change, e.g. "text_1", exactly as returned by get_scene.',
          },
          x: { type: 'number', description: 'New left edge in canvas pixels, from the left.' },
          y: { type: 'number', description: 'New top edge in canvas pixels, from the top.' },
          width: { type: 'number', description: 'New width in canvas pixels.' },
          height: { type: 'number', description: 'New height in canvas pixels.' },
          fill: {
            type: 'string',
            description: 'New fill colour as CSS hex, e.g. "#f59e0b". Use "transparent" for none.',
          },
          stroke: { type: 'string', description: 'New outline colour as CSS hex.' },
          text: {
            type: 'string',
            description: 'New text content. Only meaningful for text objects.',
          },
          fontSize: {
            type: 'number',
            description: 'New font size in canvas pixels. Only meaningful for text objects.',
          },
          opacity: {
            type: 'number',
            description: 'New opacity from 0 (invisible) to 1 (solid).',
          },
          rotation: { type: 'number', description: 'New rotation in degrees, clockwise.' },
          role: {
            type: 'string',
            description:
              'Semantic slot this object fills: headline, subhead, body, accent, image-slot, ' +
              'background. Pass an empty string to clear it.',
          },
        },
        required: ['id'],
      },
      execute: args => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        const { map } = scene
        const raw = typeof args.id === 'string' ? args.id : ''
        const id = resolveAlias(map, raw)
        if (!id) return fail(unknownIdMessage(map, raw))

        const patch: Record<string, unknown> = {}
        if (typeof args.x === 'number') patch.left = args.x
        if (typeof args.y === 'number') patch.top = args.y
        if (typeof args.width === 'number') patch.width = args.width
        if (typeof args.height === 'number') patch.height = args.height
        if (typeof args.fill === 'string') patch.fill = args.fill
        if (typeof args.stroke === 'string') patch.stroke = args.stroke
        if (typeof args.text === 'string') patch.text = args.text
        if (typeof args.fontSize === 'number') patch.fontSize = args.fontSize
        if (typeof args.opacity === 'number') patch.opacity = args.opacity
        if (typeof args.rotation === 'number') patch.angle = args.rotation
        if (typeof args.role === 'string') patch.role = args.role

        if (Object.keys(patch).length === 0) {
          return fail(
            `Nothing to change on ${aliasFor(map, id)}. Pass at least one property, ` +
              'such as fill, text, fontSize, x or y.',
          )
        }

        ref.current?.updateObject(id, patch)

        const after = readScene(ref)
        const updated = after?.canvas.objects.find(o => o.id === id)
        if (!after || !updated) return ok(`Updated ${aliasFor(map, id)}.`)
        return ok(
          ['Updated. That object is now:', '', objectRow(after.map, updated, !!updated.role)].join(
            '\n',
          ),
        )
      },
    },
  ]

  return tools.map(t => guarded(t.name, t))
}
