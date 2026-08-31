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
  DUET_TEMPLATES,
  findTemplate,
  TEMPLATE_FONT_FAMILIES,
  TEMPLATE_IDS,
} from '../data/templates'
import {
  type AliasMap,
  aliasFor,
  buildAliasMap,
  resolveAlias,
  unknownIdMessage,
} from './avnac-ai-aliases'
import type { AiCanvasInfo, AiDesignController, AiObjectSummary } from './avnac-ai-controller'
import { fail, guarded, ok, type WebMcpTool } from './avnac-webmcp'
import { ensureGoogleFontsForFamilies } from './load-google-font'

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

/**
 * Wait for React to commit a scene change.
 *
 * Mutations go through setDoc, which re-renders and rebuilds the controller.
 * Reading back in the same tick can still see the pre-change scene, so every
 * tool that reports resulting state awaits this first.
 */
function settle(): Promise<void> {
  return new Promise(resolve => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    // Two frames is the fast path when the tab is visible.
    requestAnimationFrame(() => requestAnimationFrame(finish))
    // requestAnimationFrame does not fire in a background tab, and an
    // agent-driven page is backgrounded constantly. Without this timeout the
    // tool never resolves and the caller hangs.
    setTimeout(finish, 150)
  })
}

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
  if (o.text) {
    // Newlines would break the one-object-per-line table, so show them as a
    // visible marker instead.
    const flat = o.text
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .join(' / ')
    bits.push(`"${flat.length > 60 ? `${flat.slice(0, 57)}...` : flat}"`)
  }
  return `  ${alias} ${role}${pos} ${size} ${bits.join('  ')}`.trimEnd()
}

export function formatScene({ canvas, map }: Scene): string {
  if (canvas.objects.length === 0) {
    return `Canvas ${canvas.width}x${canvas.height} - background ${canvas.background ?? 'none'}. The canvas is empty.`
  }
  const showRole = canvas.objects.some(o => o.role)
  const head =
    `Canvas ${canvas.width}x${canvas.height} - background ${canvas.background ?? 'none'} - ` +
    `${canvas.objects.length} object(s), listed back to front (the last one is on top)`
  return [head, '', ...canvas.objects.map(o => objectRow(map, o, showRole))].join('\n')
}

type FilterResult = { ok: true; matched: AiObjectSummary[] } | { ok: false; message: string }

/** Shared by select_objects and update_many so their matching cannot drift. */
function matchObjects(scene: Scene, args: Record<string, unknown>): FilterResult {
  const { canvas, map } = scene
  const ids = Array.isArray(args.ids) ? (args.ids as string[]) : null
  const type = typeof args.type === 'string' ? args.type.toLowerCase() : null
  const role = typeof args.role === 'string' ? args.role.toLowerCase() : null
  const phrase = typeof args.text_contains === 'string' ? args.text_contains.toLowerCase() : null

  if (!ids && !type && !role && !phrase) {
    return {
      ok: false,
      message:
        'Give at least one of: ids, type, role, or text_contains. ' +
        `Objects available: ${map.aliases.join(', ') || 'none, the canvas is empty'}.`,
    }
  }

  let matched = canvas.objects
  if (ids) {
    const missing = ids.filter(v => resolveAlias(map, v) === null)
    if (missing.length > 0) return { ok: false, message: unknownIdMessage(map, missing.join(', ')) }
    const wanted = new Set(
      ids.map(v => resolveAlias(map, v)).filter((v): v is string => v !== null),
    )
    matched = matched.filter(o => wanted.has(o.id))
  }
  if (type) matched = matched.filter(o => o.kind.toLowerCase() === type)
  if (role) matched = matched.filter(o => (o.role ?? '').toLowerCase() === role)
  if (phrase) matched = matched.filter(o => (o.text ?? '').toLowerCase().includes(phrase))
  return { ok: true, matched }
}

const FILTER_PROPERTIES = {
  ids: {
    type: 'array',
    items: { type: 'string' },
    description: 'Object ids, e.g. ["text_1", "rect_2"], exactly as returned by get_scene.',
  },
  type: {
    type: 'string',
    description: 'Every object of this kind: text, rect, ellipse, image, line, icon, group.',
  },
  role: {
    type: 'string',
    description:
      'Every object filling this template slot: headline, subhead, body, accent, ' +
      'image-slot, background.',
  },
  text_contains: {
    type: 'string',
    description: 'Text objects whose content contains this phrase. Case insensitive.',
  },
} as const

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
      inputSchema: { type: 'object', properties: { ...FILTER_PROPERTIES }, required: [] },
      execute: args => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        const { map } = scene
        const result = matchObjects(scene, args)
        if (!result.ok) return fail(result.message)
        const matched = result.matched

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
        'text or font size changes, so you do not need to adjust height yourself. To apply the ' +
        'same change to several objects, use update_many instead - one call rather than many.',
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
      execute: async args => {
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
        await settle()

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
    {
      name: 'list_templates',
      description:
        'List the starting layouts available. Always call this before building a design, and ' +
        'always start from one of these rather than composing a layout from scratch - placing ' +
        'objects by coordinate produces overlapping text and colours that clash. If nothing ' +
        'matches the request exactly, pick the closest layout and restyle it with update_many. ' +
        'Never refuse a request for want of an exact template.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      annotations: { readOnlyHint: true },
      execute: () =>
        ok(
          [
            DUET_TEMPLATES.length + ' templates available:',
            '',
            ...DUET_TEMPLATES.map(
              t =>
                '  ' +
                t.id.padEnd(14) +
                ' ' +
                (t.width + 'x' + t.height).padEnd(10) +
                ' ' +
                t.name +
                ' - ' +
                t.occasion,
            ),
            '',
            'Apply one with apply_template, then fill it in with update_many by role.',
          ].join('\n'),
        ),
    },

    {
      name: 'apply_template',
      description:
        'Load a starting layout onto the canvas, then return the result so you can fill it in ' +
        'immediately. This REPLACES everything currently on the canvas, so use it to begin a ' +
        'design, never to add to one. Every object comes with a role - headline, subhead, body, ' +
        'accent, background - so the usual next step is update_many by role to put the real ' +
        'words and colours in.',
      inputSchema: {
        type: 'object',
        properties: {
          template_id: {
            type: 'string',
            description: 'Which layout to load. One of: ' + TEMPLATE_IDS.join(', ') + '.',
          },
        },
        required: ['template_id'],
      },
      execute: async args => {
        const wanted = typeof args.template_id === 'string' ? args.template_id : ''
        const template = findTemplate(wanted)
        if (!template) {
          return fail(
            'No template called "' +
              wanted +
              '". Available templates: ' +
              TEMPLATE_IDS.join(', ') +
              '.',
          )
        }
        // Measuring text before its font is ready produces wrong heights, and
        // that only becomes visible once the layout is on screen.
        await ensureGoogleFontsForFamilies(TEMPLATE_FONT_FAMILIES)
        const loaded = ref.current?.loadDocument(template.document)
        if (loaded === null || loaded === undefined) {
          return fail('The "' + template.id + '" template could not be loaded.')
        }
        await settle()
        const after = readScene(ref)
        if (!after) return ok('Applied the ' + template.name + ' template.')
        return ok(
          ['Applied the ' + template.name + ' template.', '', formatScene(after)].join('\n'),
        )
      },
    },

    {
      name: 'add_object',
      description:
        'Add one new object on top of what is already there. Use this for an extra element the ' +
        'layout did not include - a badge, a rule, a caption. Do not use it to build a layout ' +
        'piece by piece: call apply_template for anything structural, because guessing positions ' +
        'for a whole design produces poor results.',
      inputSchema: {
        type: 'object',
        properties: {
          type: { type: 'string', description: 'What to add: text, rect, ellipse, or image.' },
          x: { type: 'number', description: 'Left edge in canvas pixels, from the left.' },
          y: { type: 'number', description: 'Top edge in canvas pixels, from the top.' },
          width: { type: 'number', description: 'Width in canvas pixels.' },
          height: { type: 'number', description: 'Height in canvas pixels. Ignored for text.' },
          text: { type: 'string', description: 'Content, when adding text.' },
          fontSize: {
            type: 'number',
            description: 'Font size in canvas pixels, when adding text.',
          },
          fill: { type: 'string', description: 'Fill colour as CSS hex, e.g. "#f59e0b".' },
          url: {
            type: 'string',
            description: 'Image source, when adding an image: an https URL or a data: URI.',
          },
          role: {
            type: 'string',
            description:
              'Semantic slot for the new object: headline, subhead, body, accent, image-slot.',
          },
        },
        required: ['type'],
      },
      execute: async args => {
        const controller = ref.current
        if (!controller) return fail(NOT_READY)
        const kind = typeof args.type === 'string' ? args.type.toLowerCase() : ''
        const x = typeof args.x === 'number' ? args.x : undefined
        const y = typeof args.y === 'number' ? args.y : undefined
        const fill = typeof args.fill === 'string' ? args.fill : undefined
        const width = typeof args.width === 'number' ? args.width : 200
        const height = typeof args.height === 'number' ? args.height : 200
        const place = { x, y, origin: 'top-left' as const }

        let created: { id: string } | null = null
        if (kind === 'text') {
          const text = typeof args.text === 'string' ? args.text : ''
          if (!text) return fail('Adding text needs a "text" value to put in it.')
          created = controller.addText({
            ...place,
            text,
            fontSize: typeof args.fontSize === 'number' ? args.fontSize : 48,
            fill,
            width: typeof args.width === 'number' ? args.width : undefined,
          })
        } else if (kind === 'rect') {
          created = controller.addRectangle({ ...place, width, height, fill })
        } else if (kind === 'ellipse') {
          created = controller.addEllipse({ ...place, width, height, fill })
        } else if (kind === 'image') {
          const url = typeof args.url === 'string' ? args.url : ''
          if (!url) return fail('Adding an image needs a "url": an https URL or a data: URI.')
          created = await controller.addImageFromUrl({ ...place, url, width, height })
        } else {
          return fail('Cannot add "' + kind + '". Supported types are: text, rect, ellipse, image.')
        }

        if (!created) return fail('The ' + kind + ' could not be added.')
        const newId = created.id
        await settle()
        if (typeof args.role === 'string' && args.role.trim()) {
          // Deliberately after settle, and through a freshly read ref: the
          // controller captured before the add is a render behind.
          ref.current?.setObjectRole(newId, args.role.trim())
          await settle()
        }
        const after = readScene(ref)
        const made = after?.canvas.objects.find(o => o.id === newId)
        if (!after || !made) return ok('Added a ' + kind + '.')
        return ok(
          ['Added a ' + kind + '. It is now:', '', objectRow(after.map, made, !!made.role)].join(
            '\n',
          ),
        )
      },
    },

    {
      name: 'update_many',
      description:
        'Apply one change across many objects in a single call. This is how a template gets ' +
        'filled in or recoloured: select by role to retitle every heading, or by type to ' +
        'restyle every text object at once. Prefer this over repeated update_object calls ' +
        'whenever the same change applies to more than one object - it is one call instead of ' +
        'twelve, and the person sees it happen in a single step.',
      inputSchema: {
        type: 'object',
        properties: {
          ...FILTER_PROPERTIES,
          text: { type: 'string', description: 'New text content for every matched text object.' },
          fill: { type: 'string', description: 'New fill colour as CSS hex, e.g. "#f59e0b".' },
          stroke: { type: 'string', description: 'New outline colour as CSS hex.' },
          fontSize: { type: 'number', description: 'New font size in canvas pixels.' },
          opacity: { type: 'number', description: 'New opacity from 0 to 1.' },
          rotation: { type: 'number', description: 'New rotation in degrees, clockwise.' },
          role: {
            type: 'string',
            description:
              'Used to SELECT objects by their template slot, not to change it. To retag an ' +
              'object, use update_object.',
          },
        },
        required: [],
      },
      execute: async args => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        const result = matchObjects(scene, args)
        if (!result.ok) return fail(result.message)
        if (result.matched.length === 0) {
          return ok(
            'Nothing matched, so nothing changed. The canvas holds: ' +
              (scene.map.aliases.join(', ') || 'nothing') +
              '.',
          )
        }

        const patch: Record<string, unknown> = {}
        if (typeof args.text === 'string') patch.text = args.text
        if (typeof args.fill === 'string') patch.fill = args.fill
        if (typeof args.stroke === 'string') patch.stroke = args.stroke
        if (typeof args.fontSize === 'number') patch.fontSize = args.fontSize
        if (typeof args.opacity === 'number') patch.opacity = args.opacity
        if (typeof args.rotation === 'number') patch.angle = args.rotation
        if (Object.keys(patch).length === 0) {
          return fail(
            'Nothing to change. Pass at least one of: text, fill, stroke, fontSize, opacity, ' +
              'rotation. Note that "role" selects objects here rather than changing them.',
          )
        }

        const ids = result.matched.map(o => o.id)
        const changed = ref.current?.updateMany(ids, patch) ?? 0
        await settle()
        const after = readScene(ref)
        if (!after) return ok('Updated ' + changed + ' object(s).')
        const rows = after.canvas.objects.filter(o => ids.includes(o.id))
        const showRole = rows.some(o => o.role)
        return ok(
          [
            'Updated ' + changed + ' object(s) in one call:',
            '',
            ...rows.map(o => objectRow(after.map, o, showRole)),
          ].join('\n'),
        )
      },
    },
  ]

  return tools.map(t => guarded(t.name, t))
}
