/**
 * Duet's WebMCP tool surface.
 *
 * Tools are built from a `MutableRefObject<AiDesignController | null>` rather
 * than the controller itself: the controller is rebuilt on every document
 * change, so closing over it directly would leave tools reading a stale scene.
 * Registration happens once; each `execute` reads the ref at call time.
 */

import type { MutableRefObject } from 'react'
import { GOOGLE_FONT_FAMILIES } from '../data/google-font-families'
import {
  allTemplates,
  DUET_TEMPLATES,
  findTemplate,
  TEMPLATE_IDS,
  templateFontFamilies,
} from '../data/templates'
import {
  type AliasMap,
  aliasFor,
  buildAliasMap,
  resolveAlias,
  unknownIdMessage,
} from './avnac-ai-aliases'
import type {
  AiCanvasInfo,
  AiDesignController,
  AiObjectSummary,
  AiReflowStrategy,
  AiShadowSpec,
  AiUpdateSpec,
} from './avnac-ai-controller'
import { describePaint, parseAiPaint } from './avnac-ai-paint'
import { type AnalysisObject, describeLayout } from './avnac-layout-analysis'
import {
  awaitDecision,
  getSnapshot as getOpenProposal,
  hasOpenProposal,
  openProposal,
  type Proposal,
} from './avnac-proposals'
import {
  kindSupportsCornerRadius,
  kindSupportsFill,
  kindSupportsOutlineStroke,
} from './avnac-scene'
import { type AvnacUpload, ensureUploadsLoaded, getUploads, uploadAlias } from './avnac-uploads'
import { ensureUserTemplatesLoaded } from './avnac-user-templates'
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
  if (o.fontFamily) bits.push(o.fontFamily)
  if (typeof o.fontWeight === 'number' && o.fontWeight !== 400) bits.push(`w${o.fontWeight}`)
  if (o.textAlign && o.textAlign !== 'left') bits.push(o.textAlign)
  if (o.fill) bits.push(`fill ${o.fill}`)
  // A stroke colour with no width renders nothing, so report them together and
  // never imply an outline exists when it is invisible.
  if (o.strokeWidth > 0 && o.stroke && o.stroke !== 'transparent') {
    bits.push(`stroke ${o.stroke} ${Math.round(o.strokeWidth)}px`)
  }
  if (o.cornerRadius > 0) bits.push(`radius ${Math.round(o.cornerRadius)}`)
  if (o.hasShadow) bits.push('shadow')
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

/**
 * Appearance properties every write tool accepts.
 *
 * Shared rather than repeated so `update_object`, `update_many` and
 * `propose_changes` cannot drift apart in what they support -- the same reason
 * `applyAiPatch` is shared between the single and batch paths.
 *
 * Geometry and `role` are deliberately absent: `update_many` uses `role` to
 * select objects rather than to set it.
 */
const STYLE_PROPERTIES = {
  fill: {
    type: 'string',
    description:
      'Fill, as CSS. A colour ("#f59e0b", "rgb(2 6 23)", "transparent") or a gradient ' +
      '("linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)"). Gradients are the fastest way ' +
      'to make a flat template look designed - try one on the background object.',
  },
  stroke: {
    type: 'string',
    description:
      'Outline paint, same CSS forms as fill. Has no visible effect on its own: set ' +
      'strokeWidth as well, because objects start with a width of 0.',
  },
  strokeWidth: {
    type: 'number',
    description: 'Outline thickness in canvas pixels. 0 removes the outline.',
  },
  cornerRadius: {
    type: 'number',
    description: 'Rounded corners in canvas pixels. Rectangles and images only.',
  },
  opacity: { type: 'number', description: 'Opacity from 0 (invisible) to 1 (solid).' },
  rotation: { type: 'number', description: 'Rotation in degrees, clockwise.' },
  blur: {
    type: 'number',
    description: 'Blur strength from 0 (sharp) to 100. Good for softening a background image.',
  },
  shadow: {
    type: ['object', 'null'],
    description:
      'Drop shadow. Pass null to remove one. Omitted fields keep their current value, so ' +
      '{"blur": 40} alone gives a soft shadow at the default offset.',
    properties: {
      blur: { type: 'number', description: 'Shadow softness in pixels.' },
      offsetX: { type: 'number', description: 'Horizontal offset in pixels.' },
      offsetY: { type: 'number', description: 'Vertical offset in pixels.' },
      color: { type: 'string', description: 'Six-digit hex, e.g. "#000000".' },
      opacity: { type: 'number', description: 'Shadow opacity from 0 to 100.' },
    },
  },
  text: { type: 'string', description: 'Text content. Only meaningful for text objects.' },
  fontSize: { type: 'number', description: 'Font size in canvas pixels. Text objects only.' },
  fontFamily: {
    type: 'string',
    description:
      'Google font family name, e.g. "Fraunces", "Inter", "Playfair Display". Text objects ' +
      'only. The font is loaded before the text is remeasured. Changing the display font is ' +
      'the single biggest change you can make to how a design reads.',
  },
  fontWeight: {
    type: 'number',
    description: 'Font weight from 100 to 900. Text objects only. 700 is bold.',
  },
  fontStyle: {
    type: 'string',
    enum: ['normal', 'italic'],
    description: 'Text objects only.',
  },
  textAlign: {
    type: 'string',
    enum: ['left', 'center', 'right', 'justify'],
    description: 'Horizontal alignment inside the text box. Text objects only.',
  },
  letterSpacing: {
    type: 'number',
    description:
      'Extra space between letters, in canvas pixels. Negative tightens. Large headlines ' +
      'usually want a small negative value.',
  },
} as const

/** The `shadow` argument, once checked. `null` means remove. */
function readShadow(raw: unknown): AiShadowSpec | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const spec: AiShadowSpec = {}
  if (typeof o.blur === 'number') spec.blur = o.blur
  if (typeof o.offsetX === 'number') spec.offsetX = o.offsetX
  if (typeof o.offsetY === 'number') spec.offsetY = o.offsetY
  if (typeof o.color === 'string') spec.color = o.color
  if (typeof o.opacity === 'number') spec.opacity = o.opacity
  return spec
}

/** Read every STYLE_PROPERTIES value present in `args` into a patch. */
function readStylePatch(args: Record<string, unknown>): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  if (typeof args.fill === 'string') patch.fill = args.fill
  if (typeof args.stroke === 'string') patch.stroke = args.stroke
  if (typeof args.strokeWidth === 'number') patch.strokeWidth = args.strokeWidth
  if (typeof args.cornerRadius === 'number') patch.cornerRadius = args.cornerRadius
  if (typeof args.opacity === 'number') patch.opacity = args.opacity
  if (typeof args.rotation === 'number') patch.angle = args.rotation
  if (typeof args.blur === 'number') patch.blurPct = args.blur
  if ('shadow' in args) {
    const shadow = readShadow(args.shadow)
    if (shadow !== undefined) patch.shadow = shadow
  }
  if (typeof args.text === 'string') patch.text = args.text
  if (typeof args.fontSize === 'number') patch.fontSize = args.fontSize
  if (typeof args.fontFamily === 'string') patch.fontFamily = args.fontFamily
  if (typeof args.fontWeight === 'number') patch.fontWeight = args.fontWeight
  if (args.fontStyle === 'normal' || args.fontStyle === 'italic') patch.fontStyle = args.fontStyle
  if (
    args.textAlign === 'left' ||
    args.textAlign === 'center' ||
    args.textAlign === 'right' ||
    args.textAlign === 'justify'
  ) {
    patch.textAlign = args.textAlign
  }
  if (typeof args.letterSpacing === 'number') patch.letterSpacing = args.letterSpacing
  return patch
}

/**
 * Resolve a requested font family against the families the editor knows, and
 * load it.
 *
 * Applying an unloaded family measures the text in a fallback face, so the box
 * ends up the wrong height and the design looks broken for reasons nothing
 * reports. Returns an error message if the family is not one we have.
 */
async function ensurePatchFont(patch: Record<string, unknown>): Promise<string | null> {
  const wanted = patch.fontFamily
  if (typeof wanted !== 'string') return null
  const match = GOOGLE_FONT_FAMILIES.find(f => f.toLowerCase() === wanted.trim().toLowerCase())
  if (!match) {
    return (
      `"${wanted}" is not a font this editor has. Use a Google Fonts family name, ` +
      'for example Inter, Fraunces, Playfair Display, Space Grotesk, Bebas Neue or Lora.'
    )
  }
  patch.fontFamily = match
  await ensureGoogleFontsForFamilies([match])
  return null
}

/** How long check_proposal waits before reporting "still pending". */
const DECISION_WAIT_MS = 20_000

/**
 * Properties in a patch that this kind of object cannot accept.
 *
 * The scene setters are deliberately forgiving: setObjectFill on a vector board
 * returns the object untouched rather than throwing. That is right for the
 * editor and wrong for an agent, which would otherwise be told "Updated" and
 * shown an unchanged canvas -- a success message for something that did not
 * happen, with nothing anywhere to reveal it.
 *
 * So every write tool asks this first and says what it had to drop.
 */
export function unappliedProperties(kind: string, patch: Record<string, unknown>): string[] {
  const dropped: string[] = []
  const isText = kind === 'text'

  if ('fill' in patch && !kindSupportsFill(kind)) dropped.push('fill')
  if ('stroke' in patch && !kindSupportsOutlineStroke(kind)) dropped.push('stroke')
  if ('strokeWidth' in patch && !kindSupportsOutlineStroke(kind)) dropped.push('strokeWidth')
  if ('cornerRadius' in patch && !kindSupportsCornerRadius(kind)) dropped.push('cornerRadius')

  for (const property of TEXT_ONLY_PROPERTIES) {
    if (property in patch && !isText) dropped.push(property)
  }
  return dropped
}

/** Patch keys that only mean anything on a text object. */
const TEXT_ONLY_PROPERTIES = [
  'text',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'fontStyle',
  'textAlign',
  'letterSpacing',
] as const

/** "a rect" but "an ellipse". This text is quoted back by agents and logged. */
function article(word: string): string {
  return /^[aeiou]/i.test(word) ? 'an' : 'a'
}

/** Why those properties were dropped, in words the agent can act on. */
export function unappliedReason(kind: string, dropped: string[]): string {
  const list = dropped.join(', ')
  const plural = dropped.length > 1 ? 'were' : 'was'
  const hint =
    kind === 'vector-board' || kind === 'group'
      ? `${article(kind)} ${kind} has no editable paint or type of its own`
      : `${article(kind)} ${kind} object has no ${
          dropped.length > 1 ? 'such properties' : dropped[0]
        }`
  return `${list} ${plural} ignored: ${hint}.`
}

/** Resolve an upload alias or raw id, the way object aliases resolve. */
function findUpload(raw: string): AvnacUpload | null {
  const uploads = getUploads()
  const wanted = raw.trim().toLowerCase()
  const index = uploads.findIndex((_, i) => uploadAlias(i) === wanted)
  if (index !== -1) return uploads[index]
  return uploads.find(u => u.id === raw.trim()) ?? null
}

/** Name what was wrong and list what exists, so the agent self-corrects. */
function unknownUploadMessage(raw: string): string {
  const uploads = getUploads()
  if (uploads.length === 0) {
    return `There is no upload called "${raw}", and nothing has been uploaded yet.`
  }
  const have = uploads.map((u, i) => `${uploadAlias(i)} (${u.name})`).join(', ')
  return `There is no upload called "${raw}". Uploads available: ${have}.`
}

/** Gradients are long; the review card only has room for the ends. */
function shortPaint(css: string): string {
  const value = parseAiPaint(css)
  return describePaint(value)
}

/** Describe a patch in the words a person would use, for the review card. */
function summarisePatch(patch: Record<string, unknown>): string {
  const bits: string[] = []
  // A person reads this row on the review card, so only name the axes that
  // actually change. "move to same,620" is not something anyone says.
  const x = typeof patch.left === 'number' ? Math.round(patch.left) : null
  const y = typeof patch.top === 'number' ? Math.round(patch.top) : null
  if (x !== null && y !== null) bits.push(`move to ${x},${y}`)
  else if (x !== null) bits.push(`move to x ${x}`)
  else if (y !== null) bits.push(`move to y ${y}`)

  const w = typeof patch.width === 'number' ? Math.round(patch.width) : null
  const h = typeof patch.height === 'number' ? Math.round(patch.height) : null
  if (w !== null && h !== null) bits.push(`resize to ${w}x${h}`)
  else if (w !== null) bits.push(`set width to ${w}`)
  else if (h !== null) bits.push(`set height to ${h}`)
  if (typeof patch.fill === 'string') bits.push(`fill ${shortPaint(patch.fill)}`)
  if (typeof patch.stroke === 'string') bits.push(`outline ${shortPaint(patch.stroke)}`)
  if (typeof patch.strokeWidth === 'number') bits.push(`outline width ${patch.strokeWidth}`)
  if (typeof patch.cornerRadius === 'number') bits.push(`corner radius ${patch.cornerRadius}`)
  if (typeof patch.blurPct === 'number') bits.push(`blur ${Math.round(patch.blurPct)}%`)
  if ('shadow' in patch) bits.push(patch.shadow === null ? 'remove shadow' : 'drop shadow')
  if (typeof patch.fontFamily === 'string') bits.push(`font ${patch.fontFamily}`)
  if (typeof patch.fontWeight === 'number') bits.push(`weight ${patch.fontWeight}`)
  if (patch.fontStyle === 'italic') bits.push('italic')
  if (typeof patch.textAlign === 'string') bits.push(`align ${patch.textAlign}`)
  if (typeof patch.letterSpacing === 'number') bits.push(`letter spacing ${patch.letterSpacing}`)
  if (typeof patch.fontSize === 'number') bits.push(`${Math.round(patch.fontSize)}px`)
  if (typeof patch.opacity === 'number') bits.push(`opacity ${patch.opacity}`)
  if (typeof patch.angle === 'number') bits.push(`rotate ${Math.round(patch.angle)} degrees`)
  if (typeof patch.text === 'string') {
    const flat = patch.text.split('\n').join(' / ')
    bits.push(`text "${flat.length > 40 ? `${flat.slice(0, 37)}...` : flat}"`)
  }
  return bits.length > 0 ? bits.join(', ') : 'no change'
}

/** Turn a settled proposal into something the agent can act on. */
function reportProposal(proposal: Proposal): string {
  if (proposal.status === 'pending') {
    return (
      'Proposal ' +
      proposal.id +
      ' is still on screen and the person has not decided yet. This is normal, not an ' +
      'error - they are looking at it. Call check_proposal again to keep waiting, or get on ' +
      'with something else and check back.'
    )
  }
  if (proposal.status === 'expired') {
    return (
      'Proposal ' +
      proposal.id +
      ' expired before the person reviewed it, so nothing was applied. Propose again if it ' +
      'still matters.'
    )
  }

  const applied = proposal.changes.filter(c => c.included && !c.gone)
  const refused = proposal.changes.filter(c => !c.included)
  const gone = proposal.changes.filter(c => c.gone)
  const lines: string[] = []

  const headline =
    proposal.status === 'approved'
      ? `The person approved all ${applied.length} change(s).`
      : proposal.status === 'rejected'
        ? 'The person rejected every change. Nothing was applied.'
        : 'The person approved ' + applied.length + ' of ' + proposal.changes.length + ' change(s).'
  lines.push(`Proposal ${proposal.id}: ${proposal.status}. ${headline}`)

  if (applied.length > 0) {
    lines.push('', 'Applied:')
    for (const c of applied) lines.push(`  ${c.alias.padEnd(9)} ${c.summary}`)
  }
  if (refused.length > 0) {
    lines.push('', 'Rejected - do not simply try these again:')
    for (const c of refused) lines.push(`  ${c.alias.padEnd(9)} ${c.summary}`)
  }
  if (gone.length > 0) {
    lines.push('', 'No longer applicable, the object was gone by then:')
    for (const c of gone) lines.push(`  ${c.alias.padEnd(9)} ${c.summary}`)
  }
  if (proposal.note) lines.push('', `They left a note: "${proposal.note}"`)
  return lines.join('\n')
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
          ...STYLE_PROPERTIES,
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

        const patch: Record<string, unknown> = readStylePatch(args)
        if (typeof args.x === 'number') patch.left = args.x
        if (typeof args.y === 'number') patch.top = args.y
        if (typeof args.width === 'number') patch.width = args.width
        if (typeof args.height === 'number') patch.height = args.height
        if (typeof args.role === 'string') patch.role = args.role

        if (Object.keys(patch).length === 0) {
          return fail(
            `Nothing to change on ${aliasFor(map, id)}. Pass at least one property, ` +
              'such as fill, text, fontSize, x or y.',
          )
        }

        const fontError = await ensurePatchFont(patch)
        if (fontError) return fail(fontError)

        // A patch this object type cannot accept would otherwise be reported as
        // a success with an unchanged canvas.
        const target = scene.canvas.objects.find(o => o.id === id)
        const dropped = target ? unappliedProperties(target.kind, patch) : []
        if (target && dropped.length === Object.keys(patch).length) {
          return fail(
            `Nothing changed on ${aliasFor(map, id)}. ` + unappliedReason(target.kind, dropped),
          )
        }

        ref.current?.updateObject(id, patch)
        await settle()

        const after = readScene(ref)
        const updated = after?.canvas.objects.find(o => o.id === id)
        if (!after || !updated) return ok(`Updated ${aliasFor(map, id)}.`)
        const note = dropped.length > 0 && target ? ` ${unappliedReason(target.kind, dropped)}` : ''
        return ok(
          [
            `Updated.${note} That object is now:`,
            '',
            objectRow(after.map, updated, !!updated.role),
          ].join('\n'),
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
      execute: async () => {
        // Saved templates live in IndexedDB, and the tool layer has no React
        // lifecycle to hydrate them. Without this the first call after a reload
        // reports only the built-in set.
        await ensureUserTemplatesLoaded()
        const templates = allTemplates()
        const saved = templates.length - DUET_TEMPLATES.length
        return ok(
          [
            `${templates.length} templates available` +
              (saved > 0 ? ` (${saved} saved by the person from their own canvas):` : ':'),
            '',
            ...templates.map(
              t =>
                '  ' +
                t.id.padEnd(18) +
                ' ' +
                `${t.width}x${t.height}`.padEnd(10) +
                ' ' +
                t.name +
                ' - ' +
                t.occasion,
            ),
            '',
            'Apply one with apply_template, then fill it in with update_many by role.',
          ].join('\n'),
        )
      },
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
            description:
              'Which layout to load. Call list_templates first: the person may have saved ' +
              `templates of their own beyond the built-in set (${TEMPLATE_IDS.join(', ')}).`,
          },
        },
        required: ['template_id'],
      },
      execute: async args => {
        const wanted = typeof args.template_id === 'string' ? args.template_id : ''
        await ensureUserTemplatesLoaded()
        const template = findTemplate(wanted)
        if (!template) {
          return fail(
            'No template called "' +
              wanted +
              '". Available templates: ' +
              allTemplates()
                .map(t => t.id)
                .join(', ') +
              '.',
          )
        }
        // Measuring text before its font is ready produces wrong heights, and
        // that only becomes visible once the layout is on screen.
        // Read the families off the document rather than assuming the built-in
        // pair: a saved template can use any family the editor offers, and text
        // measured against a fallback face gets the wrong height silently.
        await ensureGoogleFontsForFamilies(templateFontFamilies(template))
        const loaded = ref.current?.loadDocument(template.document)
        if (loaded === null || loaded === undefined) {
          return fail(`The "${template.id}" template could not be loaded.`)
        }
        await settle()
        const after = readScene(ref)
        if (!after) return ok(`Applied the ${template.name} template.`)
        return ok([`Applied the ${template.name} template.`, '', formatScene(after)].join('\n'))
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
          upload_id: {
            type: 'string',
            description:
              'An image the person has already uploaded, e.g. "upload_1" from list_uploads. ' +
              'PREFER this over url whenever they refer to something of their own - "my photo", ' +
              '"the logo I added", "that picture".',
          },
          url: {
            type: 'string',
            description:
              'Image source when adding an image the person has not uploaded: a data: URI, or ' +
              'an https URL. A remote URL only works if that host sends CORS headers, so a ' +
              'data: URI is the reliable choice.',
          },
          ...STYLE_PROPERTIES,
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
          let url = typeof args.url === 'string' ? args.url : ''
          const uploadId = typeof args.upload_id === 'string' ? args.upload_id.trim() : ''
          if (uploadId) {
            await ensureUploadsLoaded()
            const upload = findUpload(uploadId)
            if (!upload) return fail(unknownUploadMessage(uploadId))
            url = upload.dataUrl
          }
          if (!url) {
            return fail(
              'Adding an image needs either an "upload_id" from list_uploads, or a "url". ' +
                'Call list_uploads to see what the person has already added.',
            )
          }
          created = await controller.addImageFromUrl({ ...place, url, width, height })
        } else {
          return fail(`Cannot add "${kind}". Supported types are: text, rect, ellipse, image.`)
        }

        if (!created) return fail(`The ${kind} could not be added.`)
        const newId = created.id
        await settle()

        // Everything beyond position and fill is applied as a normal patch, so
        // a new object reaches exactly the same styling as an existing one and
        // the two paths cannot drift apart.
        const style = readStylePatch(args)
        const droppedOnNew = unappliedProperties(kind, style)
        if (Object.keys(style).length > 0) {
          const fontError = await ensurePatchFont(style)
          if (fontError) return fail(fontError)
          ref.current?.updateObject(newId, style)
          await settle()
        }

        if (typeof args.role === 'string' && args.role.trim()) {
          // Deliberately after settle, and through a freshly read ref: the
          // controller captured before the add is a render behind.
          ref.current?.setObjectRole(newId, args.role.trim())
          await settle()
        }
        const after = readScene(ref)
        const made = after?.canvas.objects.find(o => o.id === newId)
        if (!after || !made) return ok(`Added ${article(kind)} ${kind}.`)
        const note = droppedOnNew.length > 0 ? ` ${unappliedReason(kind, droppedOnNew)}` : ''
        return ok(
          [
            `Added ${article(kind)} ${kind}.${note} It is now:`,
            '',
            objectRow(after.map, made, !!made.role),
          ].join('\n'),
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
          ...STYLE_PROPERTIES,
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

        const patch: Record<string, unknown> = readStylePatch(args)
        if (Object.keys(patch).length === 0) {
          return fail(
            'Nothing to change. Pass at least one appearance property, such as text, fill, ' +
              'fontSize, fontFamily or cornerRadius. Note that "role" selects objects here ' +
              'rather than changing them.',
          )
        }

        const fontError = await ensurePatchFont(patch)
        if (fontError) return fail(fontError)

        // Matches can be of mixed kinds, so report per property how many of them
        // could not take it rather than pretending the batch was uniform.
        const dropCounts = new Map<string, number>()
        for (const o of result.matched) {
          for (const property of unappliedProperties(o.kind, patch)) {
            dropCounts.set(property, (dropCounts.get(property) ?? 0) + 1)
          }
        }
        const total = result.matched.length
        const fullyDropped = [...dropCounts.entries()]
          .filter(([, count]) => count === total)
          .map(([property]) => property)
        if (fullyDropped.length === Object.keys(patch).length) {
          return fail(
            `Nothing changed. ${fullyDropped.join(', ')} cannot apply to any of the ` +
              `${total} matched object(s): ${[...new Set(result.matched.map(o => o.kind))].join(', ')}.`,
          )
        }

        const ids = result.matched.map(o => o.id)
        const changed = ref.current?.updateMany(ids, patch) ?? 0
        await settle()
        const after = readScene(ref)
        const notes = [...dropCounts.entries()].map(
          ([property, count]) => `${property} was ignored on ${count} of ${total}`,
        )
        const head =
          `Updated ${changed} object(s) in one call` +
          (notes.length > 0 ? ` (${notes.join('; ')}):` : ':')
        if (!after) return ok(head)
        const rows = after.canvas.objects.filter(o => ids.includes(o.id))
        const showRole = rows.some(o => o.role)
        return ok([head, '', ...rows.map(o => objectRow(after.map, o, showRole))].join('\n'))
      },
    },
    {
      name: 'describe_layout',
      description:
        'Inspect the design for problems a person would notice: things that overlap, things ' +
        'that fall outside the frame, edges that are almost-but-not-quite aligned, and text ' +
        'that is hard to read against what sits behind it. Use it after building or resizing ' +
        'something, to check your own work before telling the person you are done. Contrast is ' +
        'measured against the dominant colour behind each piece of text, and full-bleed ' +
        'backgrounds are ignored so they do not count as overlapping everything.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      annotations: { readOnlyHint: true },
      execute: () => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        const objects: AnalysisObject[] = scene.canvas.objects.map(o => ({
          alias: aliasFor(scene.map, o.id),
          role: o.role,
          kind: o.kind,
          left: o.left,
          top: o.top,
          width: o.width,
          height: o.height,
          angle: o.angle,
          fill: o.fill,
          text: o.text,
          fontSize: o.fontSize,
          opacity: o.opacity,
          visible: o.visible,
        }))
        return ok(
          describeLayout(objects, {
            width: scene.canvas.width,
            height: scene.canvas.height,
            background: scene.canvas.background,
          }),
        )
      },
    },

    {
      name: 'resize_canvas',
      description:
        'Change the canvas size and reflow what is on it. Common sizes: Instagram story, reel or ' +
        'TikTok 1080x1920, square post 1080x1080, portrait post 1080x1350, landscape 1920x1080. ' +
        'Choose the strategy deliberately - it decides whether the result still looks designed. ' +
        'After a big aspect change, follow up with describe_layout to see what moved. ' +
        'IMPORTANT when making several platform versions of one design: each resize transforms ' +
        'whatever is on the canvas NOW, so chaining them compounds. Portrait to story to square ' +
        'shrinks the design twice and leaves it as a narrow column stranded in the middle. ' +
        'Return to the original size, or re-apply the source template, between versions - so ' +
        'every export starts from the full-size design rather than the previous crop.',
      inputSchema: {
        type: 'object',
        properties: {
          width: { type: 'number', description: 'New canvas width in pixels, 100 to 16000.' },
          height: { type: 'number', description: 'New canvas height in pixels, 100 to 16000.' },
          strategy: {
            type: 'string',
            description:
              'How existing objects respond. "scale" stretches everything to the new ' +
              'proportions - right when the shape barely changes. "fit" scales everything ' +
              'uniformly and centres it - right for a big aspect change, since nothing gets ' +
              'distorted, though margins grow. "keep_positions" moves only the frame and leaves ' +
              'objects where they are - right when the person wants to recompose by hand, and ' +
              'the honest choice when you are unsure. Defaults to "fit".',
          },
        },
        required: ['width', 'height'],
      },
      execute: async args => {
        const controller = ref.current
        if (!controller) return fail(NOT_READY)
        const clamp = (v: unknown) =>
          typeof v === 'number' && Number.isFinite(v)
            ? Math.round(Math.max(100, Math.min(16000, v)))
            : null
        const width = clamp(args.width)
        const height = clamp(args.height)
        if (width === null || height === null) {
          return fail('Give a numeric width and height, each between 100 and 16000 pixels.')
        }
        const asked = typeof args.strategy === 'string' ? args.strategy.toLowerCase() : 'fit'
        const allowed: AiReflowStrategy[] = ['scale', 'fit', 'keep_positions']
        if (!allowed.includes(asked as AiReflowStrategy)) {
          return fail(`Unknown strategy "${asked}". Use one of: ${allowed.join(', ')}.`)
        }
        const before = controller.getCanvas()
        controller.resizeArtboard(width, height, asked as AiReflowStrategy)
        await settle()
        const after = readScene(ref)
        const head =
          'Canvas resized from ' +
          (before ? `${before.width}x${before.height}` : 'its previous size') +
          ' to ' +
          width +
          'x' +
          height +
          ' using "' +
          asked +
          '".'
        if (!after) return ok(head)
        return ok([head, '', formatScene(after)].join('\n'))
      },
    },

    {
      name: 'align_objects',
      description:
        'Line up several objects along a shared edge or centre, or space them evenly. Aligns ' +
        'to the group they form, so nothing jumps far from where it already sits. If only one ' +
        'object matches, it aligns to the canvas instead - which is what someone means by ' +
        '"centre this". Select the objects the same way as select_objects: by ids, type, role, ' +
        'or text.',
      inputSchema: {
        type: 'object',
        properties: {
          ...FILTER_PROPERTIES,
          mode: {
            type: 'string',
            description:
              'left, right, center_h, top, bottom, center_v to line objects up; ' +
              'distribute_h or distribute_v to space three or more evenly.',
          },
        },
        required: ['mode'],
      },
      execute: async args => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        const mode = typeof args.mode === 'string' ? args.mode.toLowerCase() : ''
        const modes = [
          'left',
          'right',
          'center_h',
          'top',
          'bottom',
          'center_v',
          'distribute_h',
          'distribute_v',
        ]
        if (!modes.includes(mode)) {
          return fail(`Unknown mode "${mode}". Use one of: ${modes.join(', ')}.`)
        }
        const result = matchObjects(scene, args)
        if (!result.ok) return fail(result.message)
        const matched = result.matched
        if (matched.length === 0) {
          return ok(
            'Nothing matched, so nothing moved. The canvas holds: ' +
              (scene.map.aliases.join(', ') || 'nothing') +
              '.',
          )
        }
        const distributing = mode.startsWith('distribute')
        if (distributing && matched.length < 3) {
          return fail(
            'Spacing objects evenly needs at least three; ' +
              matched.length +
              ' matched. Use left/center_h/right to line them up instead.',
          )
        }

        // A single object has no group to align within, so the canvas is the
        // only sensible frame of reference.
        const single = matched.length === 1
        const bounds = single
          ? { left: 0, top: 0, right: scene.canvas.width, bottom: scene.canvas.height }
          : {
              left: Math.min(...matched.map(o => o.left)),
              top: Math.min(...matched.map(o => o.top)),
              right: Math.max(...matched.map(o => o.left + o.width)),
              bottom: Math.max(...matched.map(o => o.top + o.height)),
            }

        const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
        if (distributing) {
          const horizontal = mode === 'distribute_h'
          const sorted = [...matched].sort((a, b) => (horizontal ? a.left - b.left : a.top - b.top))
          const span = horizontal
            ? sorted[sorted.length - 1].left - sorted[0].left
            : sorted[sorted.length - 1].top - sorted[0].top
          const step = span / (sorted.length - 1)
          sorted.forEach((o, i) => {
            const value = (horizontal ? sorted[0].left : sorted[0].top) + step * i
            updates.push({
              id: o.id,
              patch: horizontal ? { left: Math.round(value) } : { top: Math.round(value) },
            })
          })
        } else {
          for (const o of matched) {
            let patch: Record<string, unknown> | null = null
            if (mode === 'left') patch = { left: Math.round(bounds.left) }
            if (mode === 'right') patch = { left: Math.round(bounds.right - o.width) }
            if (mode === 'center_h') {
              patch = { left: Math.round((bounds.left + bounds.right) / 2 - o.width / 2) }
            }
            if (mode === 'top') patch = { top: Math.round(bounds.top) }
            if (mode === 'bottom') patch = { top: Math.round(bounds.bottom - o.height) }
            if (mode === 'center_v') {
              patch = { top: Math.round((bounds.top + bounds.bottom) / 2 - o.height / 2) }
            }
            if (patch) updates.push({ id: o.id, patch })
          }
        }

        const changed = ref.current?.updateEach(updates) ?? 0
        await settle()
        const after = readScene(ref)
        if (!after) return ok(`Aligned ${changed} object(s).`)
        const ids = updates.map(u => u.id)
        const rows = after.canvas.objects.filter(o => ids.includes(o.id))
        const showRole = rows.some(o => o.role)
        return ok(
          [
            `Aligned ${changed} object(s) using "${mode}":`,
            '',
            ...rows.map(o => objectRow(after.map, o, showRole)),
          ].join('\n'),
        )
      },
    },

    {
      name: 'delete_objects',
      description:
        'Permanently remove objects from the design. This cannot be undone from your side, so ' +
        'when a request is at all ambiguous, call select_objects first and let the person see ' +
        'what you mean before removing anything. Select the same way as select_objects: by ids, ' +
        'type, role, or text.',
      inputSchema: { type: 'object', properties: { ...FILTER_PROPERTIES }, required: [] },
      execute: async args => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        const result = matchObjects(scene, args)
        if (!result.ok) return fail(result.message)
        if (result.matched.length === 0) {
          return ok(
            'Nothing matched, so nothing was deleted. The canvas holds: ' +
              (scene.map.aliases.join(', ') || 'nothing') +
              '.',
          )
        }
        const names = result.matched.map(o => aliasFor(scene.map, o.id))
        const removed = ref.current?.deleteMany(result.matched.map(o => o.id)) ?? 0
        await settle()
        const after = readScene(ref)
        const head = `Deleted ${removed} object(s): ${names.join(', ')}.`
        if (!after) return ok(head)
        return ok([head, '', formatScene(after)].join('\n'))
      },
    },
    {
      name: 'propose_changes',
      description:
        'Suggest a batch of edits WITHOUT applying them. The person sees a ghosted preview on ' +
        'their canvas and approves or rejects each one; nothing changes until they do. Use this ' +
        'for anything where taste is involved - a re-layout, a restyle, a batch of moves after ' +
        'a resize - rather than editing directly and hoping they agree. Returns straight away ' +
        'with a proposal id; call check_proposal to hear what they decided. Only changes to ' +
        'existing objects are supported: to add or delete, use add_object or delete_objects.',
      inputSchema: {
        type: 'object',
        properties: {
          rationale: {
            type: 'string',
            description:
              'One sentence, addressed to the person, saying what you are suggesting and why. ' +
              'Shown at the top of their review card.',
          },
          changes: {
            type: 'array',
            description: 'The edits to preview. Each needs an id plus at least one property.',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string', description: 'Object to change, e.g. "text_1".' },
                x: { type: 'number', description: 'New left edge in canvas pixels.' },
                y: { type: 'number', description: 'New top edge in canvas pixels.' },
                width: { type: 'number', description: 'New width in canvas pixels.' },
                height: { type: 'number', description: 'New height in canvas pixels.' },
                ...STYLE_PROPERTIES,
              },
              required: ['id'],
            },
          },
        },
        required: ['rationale', 'changes'],
      },
      execute: async args => {
        const scene = readScene(ref)
        if (!scene) return fail(NOT_READY)
        if (hasOpenProposal()) {
          const open = getOpenProposal()
          return fail(
            'A proposal is already on screen' +
              (open ? ` (${open.id})` : '') +
              ' waiting for the person. Two ghosted previews at once are unreadable - wait for ' +
              'that decision with check_proposal before proposing anything else.',
          )
        }
        const raw = Array.isArray(args.changes) ? (args.changes as Record<string, unknown>[]) : []
        if (raw.length === 0) {
          return fail('A proposal needs at least one change. Pass changes: [{ id, ... }].')
        }

        const changes: Array<{
          id: string
          alias: string
          patch: AiUpdateSpec
          summary: string
        }> = []
        const unknown: string[] = []
        for (const entry of raw) {
          const asked = typeof entry.id === 'string' ? entry.id : ''
          const id = resolveAlias(scene.map, asked)
          if (!id) {
            unknown.push(asked || '(missing id)')
            continue
          }
          const patch: Record<string, unknown> = readStylePatch(entry)
          if (typeof entry.x === 'number') patch.left = entry.x
          if (typeof entry.y === 'number') patch.top = entry.y
          if (typeof entry.width === 'number') patch.width = entry.width
          if (typeof entry.height === 'number') patch.height = entry.height
          if (Object.keys(patch).length === 0) continue
          // Ghosts are measured as soon as they render, so a proposed font has
          // to be loaded before the preview, not on approval.
          const fontError = await ensurePatchFont(patch)
          if (fontError) return fail(fontError)
          // A change that cannot apply would ghost as nothing at all, so the
          // person would be asked to approve an invisible edit.
          const target = scene.canvas.objects.find(o => o.id === id)
          if (target) {
            const dropped = unappliedProperties(target.kind, patch)
            if (dropped.length === Object.keys(patch).length) {
              return fail(
                `The change to ${aliasFor(scene.map, id)} would do nothing, so there is no ` +
                  `proposal worth showing. ${unappliedReason(target.kind, dropped)}`,
              )
            }
            for (const property of dropped) delete patch[property]
          }
          changes.push({
            id,
            alias: aliasFor(scene.map, id),
            patch,
            summary: summarisePatch(patch),
          })
        }

        if (unknown.length > 0) {
          return fail(unknownIdMessage(scene.map, unknown.join(', ')))
        }
        if (changes.length === 0) {
          return fail(
            'None of those changes had a property to change. Give each one at least one of: ' +
              'x, y, width, height, fill, text, fontSize, opacity, rotation.',
          )
        }

        const rationale =
          typeof args.rationale === 'string' && args.rationale.trim()
            ? args.rationale.trim()
            : 'The agent suggested some changes.'
        const proposal = openProposal({ rationale, changes })

        return ok(
          [
            'Proposal ' +
              proposal.id +
              " is now on the person's screen as a ghosted preview, with " +
              changes.length +
              ' change(s):',
            '',
            ...changes.map(c => `  ${c.alias.padEnd(9)} ${c.summary}`),
            '',
            'Nothing has been applied. Call check_proposal with proposal_id "' +
              proposal.id +
              '" to hear what they decided.',
          ].join('\n'),
        )
      },
    },

    {
      name: 'check_proposal',
      description:
        'Ask what the person decided about a proposal. Waits up to twenty seconds for them, ' +
        'then answers. A "still pending" answer means they are reading it - that is normal, ' +
        'not a failure, so call again rather than giving up or re-proposing. Once they decide ' +
        'you get the per-change breakdown and any note they left.',
      inputSchema: {
        type: 'object',
        properties: {
          proposal_id: {
            type: 'string',
            description: 'The id returned by propose_changes, e.g. "p_1".',
          },
        },
        required: ['proposal_id'],
      },
      execute: async args => {
        const id = typeof args.proposal_id === 'string' ? args.proposal_id.trim() : ''
        if (!id) return fail('Give the proposal_id that propose_changes returned, e.g. "p_1".')
        const settled = await awaitDecision(id, DECISION_WAIT_MS)
        if (!settled) {
          return fail(
            'There is no proposal called "' +
              id +
              '". It may have been decided and dismissed already, or the page was reloaded.',
          )
        }
        const after = readScene(ref)
        const report = reportProposal(settled)
        if (settled.status === 'pending' || !after) return ok(report)
        return ok([report, '', formatScene(after)].join('\n'))
      },
    },

    {
      name: 'list_uploads',
      description:
        'List the images the person has uploaded into this editor. Use this whenever they refer ' +
        'to an image of their own - "my photo", "the logo I uploaded", "that picture" - so you ' +
        'can place the real file rather than guessing at a URL. Pass an id from here to ' +
        'add_object as upload_id.',
      inputSchema: { type: 'object', properties: {}, required: [] },
      annotations: { readOnlyHint: true },
      execute: async () => {
        const uploads = await ensureUploadsLoaded()
        if (uploads.length === 0) {
          return ok(
            'Nothing has been uploaded. The person can drop an image straight onto the canvas, ' +
              'or add one from the Uploads panel in the left sidebar.',
          )
        }
        return ok(
          [
            `${uploads.length} uploaded image(s):`,
            '',
            ...uploads.map(
              (u, i) =>
                '  ' +
                uploadAlias(i).padEnd(10) +
                ' ' +
                `${u.width}x${u.height}`.padEnd(11) +
                ' ' +
                u.name,
            ),
            '',
            'Place one with add_object { type: "image", upload_id: "upload_1" }.',
          ].join('\n'),
        )
      },
    },

    {
      name: 'set_background',
      description:
        'Set the canvas background behind every object. Accepts a CSS colour or a CSS ' +
        'linear-gradient, e.g. "#0f172a" or "linear-gradient(160deg, #1e1b4b 0%, #7c3aed 100%)". ' +
        'Note that templates also carry a full-bleed background RECTANGLE sitting on top of ' +
        'this, so when a template is loaded you usually want to change that object instead, ' +
        'with update_many({ role: "background", fill: ... }). Call get_scene first and look ' +
        'for an object with the background role.',
      inputSchema: {
        type: 'object',
        properties: {
          paint: {
            type: 'string',
            description:
              'A CSS colour or linear-gradient. Gradients take an angle and any number of ' +
              'stops: "linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)".',
          },
        },
        required: ['paint'],
      },
      execute: async args => {
        const controller = ref.current
        if (!controller) return fail(NOT_READY)
        const paint = typeof args.paint === 'string' ? args.paint.trim() : ''
        if (!paint) return fail('Give a "paint" value: a CSS colour or a linear-gradient.')

        controller.setBackground(paint)
        await settle()
        const after = readScene(ref)
        const head = `Canvas background is now ${describePaint(parseAiPaint(paint))}.`
        if (!after) return ok(head)
        // The canvas background is invisible under a template, so say so rather
        // than letting the agent believe a change landed that nobody can see.
        const covering = after.canvas.objects.find(o => o.role === 'background')
        const note = covering
          ? ` Note that ${aliasFor(after.map, covering.id)} still covers the whole canvas, so ` +
            'this is not visible until that object changes too.'
          : ''
        return ok([head + note, '', formatScene(after)].join('\n'))
      },
    },

    {
      name: 'export_design',
      description:
        'Render the finished design and hand the person the image file. Use this when they ask ' +
        'to save, download or export. The file goes straight to their downloads and is NOT ' +
        'returned to you: an image this size would be tens of thousands of tokens and of no ' +
        'use to you. Worth calling describe_layout first, since exporting is usually the last ' +
        'step and a defect is cheaper to fix before it is saved.',
      inputSchema: {
        type: 'object',
        properties: {
          format: {
            type: 'string',
            enum: ['png', 'jpg', 'webp'],
            description:
              'Image format. PNG is the safe default and the only one keeping transparency.',
          },
          scale: {
            type: 'number',
            description:
              'Resolution multiplier, 1 to 4. 1 exports at the canvas size; 2 is the right ' +
              'choice for print or a retina screen.',
          },
          transparent: {
            type: 'boolean',
            description:
              'Drop the canvas background so the image has none. PNG and WebP only, and only ' +
              'visible when no full-bleed background object covers the canvas.',
          },
          file_name: {
            type: 'string',
            description: 'Name for the file, without an extension. Defaults to "duet-design".',
          },
        },
        required: [],
      },
      execute: async args => {
        const controller = ref.current
        if (!controller) return fail(NOT_READY)
        const format =
          args.format === 'jpg' || args.format === 'webp' ? args.format : ('png' as const)
        const scale =
          typeof args.scale === 'number' ? Math.max(1, Math.min(4, Math.round(args.scale))) : 1
        const askedTransparent = args.transparent === true
        const transparent = askedTransparent && format !== 'jpg'
        const fileName = typeof args.file_name === 'string' ? args.file_name : undefined

        const written = await controller.exportImage({ format, scale, transparent, fileName })
        if (!written) return fail('The canvas could not be rendered, so nothing was exported.')
        const caveat =
          askedTransparent && format === 'jpg'
            ? ' JPG cannot hold transparency, so the background was kept.'
            : ''
        return ok(
          `Exported ${written.fileName} at ${written.width}x${written.height} pixels, ` +
            'downloaded to their device.' +
            caveat,
        )
      },
    },
  ]

  return tools.map(t => guarded(t.name, t))
}
