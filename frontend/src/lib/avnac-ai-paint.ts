/**
 * Paint parsing for the agent-facing tools.
 *
 * The editor's paint model is a discriminated union -- a solid colour or a
 * gradient with stops and an angle. Exposing that shape directly would mean a
 * nested object on every schema that touches colour, in four different tools.
 *
 * So the tool boundary takes a single string and accepts CSS: either a plain
 * colour, or `linear-gradient(...)`. A model writes that notation fluently
 * without being taught it, the schemas stay one property wide, and gradients
 * become reachable from every tool that already had a colour.
 */

import type { BgValue, GradientStop } from '../components/background-popover'

/** Keyword directions CSS allows in place of an angle. */
const DIRECTION_ANGLES: Record<string, number> = {
  'to top': 0,
  'to right': 90,
  'to bottom': 180,
  'to left': 270,
  'to top right': 45,
  'to right top': 45,
  'to bottom right': 135,
  'to right bottom': 135,
  'to bottom left': 225,
  'to left bottom': 225,
  'to top left': 315,
  'to left top': 315,
}

export function gradientCssFromStops(stops: readonly GradientStop[], angle: number): string {
  const body = stops.map(s => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ')
  return `linear-gradient(${Math.round(angle)}deg, ${body})`
}

/**
 * Split on top-level commas only.
 *
 * `rgb(0, 0, 0) 50%` contains commas that are not stop separators, so a plain
 * `split(',')` shreds it.
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''
  for (const ch of input) {
    if (ch === '(') depth += 1
    else if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) {
      parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim().length > 0) parts.push(current.trim())
  return parts
}

function parseAngle(raw: string): number | null {
  const text = raw.trim().toLowerCase()
  const deg = /^(-?[\d.]+)deg$/.exec(text)
  if (deg) {
    const n = Number(deg[1])
    if (!Number.isFinite(n)) return null
    return ((n % 360) + 360) % 360
  }
  const direction = DIRECTION_ANGLES[text.replace(/\s+/g, ' ')]
  return direction ?? null
}

/**
 * Pull the colour and optional position out of one stop.
 *
 * The position is the trailing `%` token; anything before it is the colour, so
 * `rgb(1, 2, 3) 40%` and `#fff 40%` both work.
 */
function parseStop(raw: string): { color: string; offset: number | null } | null {
  const text = raw.trim()
  if (text.length === 0) return null
  const withPercent = /^(.*?)\s+(-?[\d.]+)%$/.exec(text)
  if (withPercent) {
    const n = Number(withPercent[2])
    if (!Number.isFinite(n)) return null
    return { color: withPercent[1].trim(), offset: Math.max(0, Math.min(1, n / 100)) }
  }
  return { color: text, offset: null }
}

/**
 * Parse `linear-gradient(...)`, or return null if this is not one.
 *
 * Deliberately tolerant: a missing angle defaults to 180deg (CSS's own
 * default), and stops without positions are spread evenly, so an agent writing
 * `linear-gradient(#f00, #00f)` gets what it obviously meant.
 */
export function parseGradient(raw: string): BgValue | null {
  const text = raw.trim()
  const match = /^linear-gradient\s*\(([\s\S]*)\)$/i.exec(text)
  if (!match) return null

  const parts = splitTopLevel(match[1])
  if (parts.length === 0) return null

  let angle = 180
  let stopParts = parts
  const leadingAngle = parseAngle(parts[0])
  if (leadingAngle !== null) {
    angle = leadingAngle
    stopParts = parts.slice(1)
  }

  const parsed = stopParts
    .map(parseStop)
    .filter((s): s is { color: string; offset: number | null } => s !== null)
  // One stop is not a gradient, and zero is not anything.
  if (parsed.length < 2) return null

  const stops: GradientStop[] = parsed.map((stop, index) => ({
    color: stop.color,
    offset: stop.offset ?? index / (parsed.length - 1),
  }))

  return { type: 'gradient', css: gradientCssFromStops(stops, angle), stops, angle }
}

/**
 * Turn an agent-supplied paint string into the editor's paint value.
 *
 * Anything that is not a parseable gradient is passed through as a solid, so
 * hex, `rgb()`, `hsl()`, named colours and `transparent` all keep working
 * exactly as they did before gradients existed.
 */
export function parseAiPaint(raw: string): BgValue {
  return parseGradient(raw) ?? { type: 'solid', color: raw.trim() }
}

/** Short human-readable form of a paint value, for tool output. */
export function describePaint(value: BgValue | null | undefined): string {
  if (!value) return 'none'
  if (value.type === 'solid') return value.color
  const ends = [value.stops[0]?.color, value.stops[value.stops.length - 1]?.color]
    .filter(Boolean)
    .join(' to ')
  return `gradient ${value.angle}deg ${ends}`.trim()
}
