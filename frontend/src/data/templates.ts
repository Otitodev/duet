/**
 * Starting layouts the agent picks from.
 *
 * An agent placing objects by typing coordinates composes badly -- it cannot
 * see the canvas, so it guesses numbers and produces overlapping text and
 * colours that fight. Templates remove that failure mode entirely: the layout
 * is authored by a person, and the agent only fills it in.
 *
 * Rules every template here follows:
 *   - 1080x1350 portrait social, except profile-card at 1080x1080
 *   - 80px margin; only `background` is allowed to bleed
 *   - headline 96px / subhead 48px / body 32px, line height 1.22
 *   - nine objects maximum
 *   - one background, one accent, one text colour, contrast checked
 *   - every object carries a role
 *   - real placeholder copy, never Lorem ipsum
 *
 * Fonts are limited to Fraunces (display) and Inter (everything else) because
 * both are already imported by styles.css. A template naming an unloaded font
 * renders in a fallback and looks broken on camera.
 */

import type { AvnacDocument, SceneObject } from '../lib/avnac-scene'
import { type AvnacUserTemplate, getUserTemplates } from '../lib/avnac-user-templates'

export const TEMPLATE_FONT_FAMILIES = ['Fraunces', 'Inter'] as const

const W = 1080
const H = 1350
const MARGIN = 80
const CONTENT = W - MARGIN * 2

const solid = (color: string) => ({ type: 'solid' as const, color })
const TRANSPARENT = solid('transparent')

let seq = 0
const nextId = (templateId: string) => `${templateId}-${(seq += 1)}`

type RectSpec = {
  role: string
  x: number
  y: number
  w: number
  h: number
  fill: string
  radius?: number
}

function tplRect(templateId: string, s: RectSpec): SceneObject {
  return {
    id: nextId(templateId),
    type: 'rect',
    x: s.x,
    y: s.y,
    width: s.w,
    height: s.h,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blurPct: 0,
    shadow: null,
    role: s.role,
    fill: solid(s.fill),
    stroke: TRANSPARENT,
    strokeWidth: 0,
    cornerRadius: s.radius ?? 0,
  }
}

type TextSpec = {
  role: string
  x: number
  y: number
  w: number
  text: string
  size: number
  fill: string
  font?: 'Fraunces' | 'Inter'
  weight?: number
  align?: 'left' | 'center' | 'right'
  tracking?: number
}

function tplText(templateId: string, s: TextSpec): SceneObject {
  return {
    id: nextId(templateId),
    type: 'text',
    x: s.x,
    y: s.y,
    width: s.w,
    // Replaced by a real measurement the moment the template is applied.
    // Counting lines here keeps the estimate close enough for centreContent.
    height: Math.round(s.size * 1.22 * s.text.split('\n').length),
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blurPct: 0,
    shadow: null,
    role: s.role,
    text: s.text,
    fill: solid(s.fill),
    stroke: TRANSPARENT,
    strokeWidth: 0,
    fontFamily: s.font ?? 'Inter',
    fontSize: s.size,
    letterSpacing: s.tracking ?? 0,
    lineHeight: 1.22,
    fontWeight: s.weight ?? 400,
    fontStyle: 'normal',
    underline: false,
    textAlign: s.align ?? 'left',
  }
}

export type DuetTemplate = {
  id: string
  name: string
  /** What the agent chooses on. Written as carefully as a tool description. */
  occasion: string
  width: number
  height: number
  document: AvnacDocument
}

function makeDocument(width: number, height: number, bg: string, objects: SceneObject[]) {
  return {
    v: 2,
    artboard: { width, height },
    bg: solid(bg),
    objects,
  } as unknown as AvnacDocument
}

/**
 * Vertically centre everything except the full-bleed background.
 *
 * Authoring by hand produced top-heavy layouts -- content ending at y=790 in a
 * 1350 canvas leaves a third of the poster empty and reads as unfinished.
 * Centring the block is the difference between "generated" and "designed".
 */
function centreContent(objects: SceneObject[], height: number): SceneObject[] {
  const movable = objects.filter(o => o.role !== 'background')
  if (movable.length === 0) return objects
  const top = Math.min(...movable.map(o => o.y))
  const bottom = Math.max(...movable.map(o => o.y + o.height))
  const shift = Math.round((height - (bottom - top)) / 2 - top)
  if (shift === 0) return objects
  const ids = new Set(movable.map(o => o.id))
  return objects.map(o => (ids.has(o.id) ? { ...o, y: o.y + shift } : o))
}

function build(
  id: string,
  name: string,
  occasion: string,
  bg: string,
  objects: SceneObject[],
  width = W,
  height = H,
): DuetTemplate {
  return {
    id,
    name,
    occasion,
    width,
    height,
    document: makeDocument(width, height, bg, centreContent(objects, height)),
  }
}

/**
 * A template from an already-built document, rather than from the tplRect and
 * tplText factories.
 *
 * Those factories only understand solid fills, so they cannot express a
 * gradient, stroke, shadow or blur. A design captured from the canvas already
 * is a document, so it needs no factories at all -- which is also the shape
 * "copy template code" emits.
 */
export function fromDocument(
  id: string,
  name: string,
  occasion: string,
  document: unknown,
): DuetTemplate {
  const doc = document as AvnacDocument
  return {
    id,
    name,
    occasion,
    width: doc.artboard.width,
    height: doc.artboard.height,
    document: doc,
  }
}

export const DUET_TEMPLATES: DuetTemplate[] = [
  build(
    'birthday',
    'Birthday',
    'Birthdays and personal celebrations. Warm, high contrast, one big name.',
    '#0f172a',
    [
      tplRect('birthday', { role: 'background', x: 0, y: 0, w: W, h: H, fill: '#0f172a' }),
      tplRect('birthday', { role: 'accent', x: MARGIN, y: 300, w: 160, h: 10, fill: '#fbbf24' }),
      tplText('birthday', {
        role: 'headline',
        x: MARGIN,
        y: 370,
        w: CONTENT,
        text: 'Happy Birthday,\nMum',
        size: 96,
        fill: '#ffffff',
        font: 'Fraunces',
        weight: 600,
      }),
      tplText('birthday', {
        role: 'subhead',
        x: MARGIN,
        y: 660,
        w: CONTENT,
        text: 'Saturday the 12th, 7pm',
        size: 48,
        fill: '#fbbf24',
        weight: 500,
      }),
      tplText('birthday', {
        role: 'body',
        x: MARGIN,
        y: 750,
        w: CONTENT,
        text: 'At the house. Bring nothing but yourself.',
        size: 32,
        fill: '#cbd5e1',
      }),
    ],
  ),

  build(
    'event',
    'Event',
    'Talks, gigs, workshops, meetups. Anything with a date, a place and a time.',
    '#14342b',
    [
      tplRect('event', { role: 'background', x: 0, y: 0, w: W, h: H, fill: '#14342b' }),
      tplText('event', {
        role: 'subhead',
        x: MARGIN,
        y: 240,
        w: CONTENT,
        text: 'LIVE IN THE GARDEN',
        size: 32,
        fill: '#8fd4b0',
        weight: 600,
        tracking: 4,
      }),
      tplText('event', {
        role: 'headline',
        x: MARGIN,
        y: 320,
        w: CONTENT,
        text: 'An Evening of\nQuiet Music',
        size: 96,
        fill: '#f7f3e8',
        font: 'Fraunces',
        weight: 600,
      }),
      tplRect('event', { role: 'accent', x: MARGIN, y: 640, w: CONTENT, h: 2, fill: '#8fd4b0' }),
      tplText('event', {
        role: 'body',
        x: MARGIN,
        y: 690,
        w: CONTENT,
        text: 'Friday 3 October · 8pm · Rose Court\nTickets at the door, £12',
        size: 32,
        fill: '#dcefe4',
      }),
    ],
  ),

  build(
    'sale',
    'Sale',
    'Discounts, launches, limited offers. Loud, one number doing all the work.',
    '#fef3c7',
    [
      tplRect('sale', { role: 'background', x: 0, y: 0, w: W, h: H, fill: '#fef3c7' }),
      tplText('sale', {
        role: 'subhead',
        x: MARGIN,
        y: 260,
        w: CONTENT,
        text: 'MIDSEASON',
        size: 48,
        fill: '#b45309',
        weight: 600,
        tracking: 6,
      }),
      tplText('sale', {
        role: 'headline',
        x: MARGIN,
        y: 340,
        w: CONTENT,
        text: '40% off\neverything',
        size: 96,
        fill: '#7c2d12',
        font: 'Fraunces',
        weight: 600,
      }),
      tplRect('sale', { role: 'accent', x: MARGIN, y: 660, w: 240, h: 12, fill: '#ea580c' }),
      tplText('sale', {
        role: 'body',
        x: MARGIN,
        y: 720,
        w: CONTENT,
        text: 'Until Sunday, in store and online.\nNo code needed.',
        size: 32,
        fill: '#78350f',
      }),
    ],
  ),

  build(
    'quote',
    'Quote',
    'A single line worth reading slowly, with an attribution. Calm and typographic.',
    '#faf7f2',
    [
      tplRect('quote', { role: 'background', x: 0, y: 0, w: W, h: H, fill: '#faf7f2' }),
      tplText('quote', {
        role: 'headline',
        x: MARGIN,
        y: 380,
        w: CONTENT,
        text: '"Simplicity is the\nresult of long,\nhard work."',
        size: 96,
        fill: '#1c1917',
        font: 'Fraunces',
        weight: 500,
      }),
      tplRect('quote', { role: 'accent', x: MARGIN, y: 830, w: 120, h: 3, fill: '#a8a29e' }),
      tplText('quote', {
        role: 'body',
        x: MARGIN,
        y: 880,
        w: CONTENT,
        text: 'Frederick Sommer',
        size: 32,
        fill: '#57534e',
        weight: 500,
      }),
    ],
  ),

  build(
    'announcement',
    'Announcement',
    'News, launches, hiring posts, anything that opens with "we are".',
    '#312e81',
    [
      tplRect('announcement', { role: 'background', x: 0, y: 0, w: W, h: H, fill: '#312e81' }),
      tplText('announcement', {
        role: 'subhead',
        x: MARGIN,
        y: 300,
        w: CONTENT,
        text: 'ANNOUNCEMENT',
        size: 32,
        fill: '#a5b4fc',
        weight: 600,
        tracking: 5,
      }),
      tplRect('announcement', {
        role: 'accent',
        x: MARGIN,
        y: 360,
        w: 140,
        h: 8,
        fill: '#a5b4fc',
      }),
      tplText('announcement', {
        role: 'headline',
        x: MARGIN,
        y: 400,
        w: CONTENT,
        text: 'We are opening\non Mondays',
        size: 96,
        fill: '#ffffff',
        font: 'Fraunces',
        weight: 600,
      }),
      tplText('announcement', {
        role: 'body',
        x: MARGIN,
        y: 720,
        w: CONTENT,
        text: 'From the first of next month, the doors open\nat nine every day of the week.',
        size: 32,
        fill: '#c7d2fe',
      }),
    ],
  ),

  build(
    'profile-card',
    'Profile card',
    'A person or a team: name, role, one line about them. Square, for avatars and grids.',
    '#fff7ed',
    [
      tplRect('profile-card', {
        role: 'background',
        x: 0,
        y: 0,
        w: 1080,
        h: 1080,
        fill: '#fff7ed',
      }),
      tplRect('profile-card', {
        role: 'image-slot',
        x: MARGIN,
        y: MARGIN,
        w: 280,
        h: 280,
        fill: '#fed7aa',
        radius: 140,
      }),
      tplText('profile-card', {
        role: 'headline',
        x: MARGIN,
        y: 440,
        w: CONTENT,
        text: 'Ada Nwosu',
        size: 96,
        fill: '#1c1917',
        font: 'Fraunces',
        weight: 600,
      }),
      tplText('profile-card', {
        role: 'subhead',
        x: MARGIN,
        y: 570,
        w: CONTENT,
        text: 'Head of Design',
        size: 48,
        fill: '#c2410c',
        weight: 500,
      }),
      tplRect('profile-card', { role: 'accent', x: MARGIN, y: 660, w: 100, h: 6, fill: '#ea580c' }),
      tplText('profile-card', {
        role: 'body',
        x: MARGIN,
        y: 710,
        w: CONTENT,
        text: 'Fifteen years making things that\nexplain themselves.',
        size: 32,
        fill: '#57534e',
      }),
    ],
    1080,
    1080,
  ),
]

export function findTemplate(id: string): DuetTemplate | null {
  const key = id.trim().toLowerCase()
  const builtIn = DUET_TEMPLATES.find(t => t.id === key)
  if (builtIn) return builtIn
  const saved = getUserTemplates().find(t => t.id.toLowerCase() === key)
  return saved ? userTemplateAsDuetTemplate(saved) : null
}

/** A saved template in the same shape as a built-in one. */
export function userTemplateAsDuetTemplate(t: AvnacUserTemplate): DuetTemplate {
  return {
    id: t.id,
    name: t.name,
    occasion: t.occasion,
    width: t.width,
    height: t.height,
    document: t.document,
  }
}

/**
 * Every template the agent can choose from: the built-in set plus anything
 * saved from the canvas in this browser.
 */
export function allTemplates(): DuetTemplate[] {
  return [...DUET_TEMPLATES, ...getUserTemplates().map(userTemplateAsDuetTemplate)]
}

/**
 * The font families a document actually uses.
 *
 * apply_template used to await a hardcoded pair, which was fine while every
 * template was Fraunces or Inter. A saved template can use any of the families
 * the editor offers, and measuring text against a fallback face gives the box
 * the wrong height with nothing to report it.
 */
export function templateFontFamilies(template: DuetTemplate): string[] {
  const families = new Set<string>(TEMPLATE_FONT_FAMILIES)
  for (const obj of template.document.objects) {
    if (obj.type === 'text' && obj.fontFamily) families.add(obj.fontFamily)
  }
  return [...families]
}

/**
 * The document a brand-new canvas starts from.
 *
 * Someone opening the live URL with no agent attached should see a real design
 * rather than an empty rectangle. Reuses a template instead of authoring
 * anything separate.
 */
export function seedDocument(): AvnacDocument {
  return (findTemplate('birthday') ?? DUET_TEMPLATES[0]).document
}

export const TEMPLATE_IDS = DUET_TEMPLATES.map(t => t.id)
