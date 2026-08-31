/**
 * Layout analysis behind `describe_layout`.
 *
 * Kept pure and free of React so the rules can be tested directly. The only
 * browser dependency is colour parsing, which degrades to null off-DOM and
 * simply skips the contrast check.
 */

export type Rgb = { r: number; g: number; b: number; a: number }

let cachedContext: CanvasRenderingContext2D | null | undefined

function colorContext(): CanvasRenderingContext2D | null {
  if (cachedContext !== undefined) return cachedContext
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 1
    canvas.height = 1
    cachedContext = canvas.getContext('2d', { willReadFrequently: true })
  } catch {
    cachedContext = null
  }
  return cachedContext
}

/**
 * Resolve any CSS colour notation to RGBA.
 *
 * Rather than parsing hex / rgb() / hsl() / named colours by hand, this paints
 * the value into a 1x1 canvas and reads the pixel back, so the browser does the
 * normalising. Invalid values are detected by assigning against two different
 * sentinels: a rejected assignment leaves fillStyle on whichever sentinel was
 * set last, so the two reads disagree.
 */
export function parseCssColor(color: string | null | undefined): Rgb | null {
  const ctx = colorContext()
  if (!ctx || !color) return null
  const value = color.trim()
  if (!value) return null

  ctx.fillStyle = '#000000'
  ctx.fillStyle = value
  const againstBlack = ctx.fillStyle
  ctx.fillStyle = '#ffffff'
  ctx.fillStyle = value
  if (againstBlack !== ctx.fillStyle) return null

  ctx.clearRect(0, 0, 1, 1)
  ctx.fillStyle = value
  ctx.fillRect(0, 0, 1, 1)
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data
  return { r, g, b, a: a / 255 }
}

function channel(value: number): number {
  const s = value / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

/** WCAG 2.1 relative luminance. */
export function relativeLuminance(c: Rgb): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b)
}

/** WCAG 2.1 contrast ratio, 1 to 21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const hi = Math.max(la, lb)
  const lo = Math.min(la, lb)
  return (hi + 0.05) / (lo + 0.05)
}

export type AnalysisObject = {
  alias: string
  role: string | null
  kind: string
  left: number
  top: number
  width: number
  height: number
  angle: number
  fill: string | null
  text: string | null
  fontSize: number | null
  opacity: number
  visible: boolean
}

export type AnalysisCanvas = { width: number; height: number; background: string | null }

const OUT_OF_BOUNDS_TOLERANCE = 1
const NEAR_MISS_MIN = 1
const NEAR_MISS_MAX = 8
const OVERLAP_MIN_FRACTION = 0.02
const FULL_BLEED_FRACTION = 0.95

const right = (o: AnalysisObject) => o.left + o.width
const bottom = (o: AnalysisObject) => o.top + o.height
const centerX = (o: AnalysisObject) => o.left + o.width / 2
const centerY = (o: AnalysisObject) => o.top + o.height / 2
const area = (o: AnalysisObject) => Math.max(0, o.width) * Math.max(0, o.height)
const label = (o: AnalysisObject) => (o.role ? `${o.alias} (${o.role})` : o.alias)

function intersectionArea(a: AnalysisObject, b: AnalysisObject): number {
  const w = Math.min(right(a), right(b)) - Math.max(a.left, b.left)
  const h = Math.min(bottom(a), bottom(b)) - Math.max(a.top, b.top)
  return w > 0 && h > 0 ? w * h : 0
}

/**
 * Objects worth analysing.
 *
 * Every template has a full-bleed background rect. Left in, it intersects
 * everything and produces one "overlap" per object on a perfectly clean
 * layout -- which teaches an agent to ignore this tool entirely.
 */
function considered(objects: AnalysisObject[], canvas: AnalysisCanvas): AnalysisObject[] {
  const canvasArea = Math.max(1, canvas.width * canvas.height)
  return objects.filter(
    o =>
      o.visible &&
      o.opacity > 0 &&
      o.role !== 'background' &&
      area(o) / canvasArea < FULL_BLEED_FRACTION,
  )
}

/**
 * A background that no longer covers the canvas.
 *
 * Backgrounds are excluded from every other check, so a resize can leave a
 * visible bare strip that nothing else here would report. That is the common
 * case after growing the canvas, which earns it a check of its own.
 */
function findBackgroundGaps(all: AnalysisObject[], canvas: AnalysisCanvas): string[] {
  const canvasArea = Math.max(1, canvas.width * canvas.height)
  const backgrounds = all.filter(
    o =>
      o.visible &&
      o.opacity > 0 &&
      (o.role === 'background' || area(o) / canvasArea >= FULL_BLEED_FRACTION),
  )
  const out: string[] = []
  for (const bg of backgrounds) {
    const spansWidth =
      bg.left <= OUT_OF_BOUNDS_TOLERANCE && right(bg) >= canvas.width - OUT_OF_BOUNDS_TOLERANCE
    const spansHeight =
      bg.top <= OUT_OF_BOUNDS_TOLERANCE && bottom(bg) >= canvas.height - OUT_OF_BOUNDS_TOLERANCE
    if (spansWidth && spansHeight) continue
    out.push(
      `${label(bg)} no longer covers the canvas - it is ${Math.round(bg.width)}x${Math.round(bg.height)} ` +
        `on a ${canvas.width}x${canvas.height} canvas, leaving a bare strip.`,
    )
  }
  return out
}

function findOverlaps(items: AnalysisObject[]): string[] {
  const out: string[] = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]
      const b = items[j]
      const overlap = intersectionArea(a, b)
      if (overlap <= 0) continue
      const smaller = Math.min(area(a), area(b))
      if (smaller <= 0) continue
      const fraction = overlap / smaller
      if (fraction < OVERLAP_MIN_FRACTION) continue
      out.push(
        `${label(a)} and ${label(b)} overlap by about ${Math.round(fraction * 100)}% of the smaller one.`,
      )
    }
  }
  return out
}

function findOutOfBounds(items: AnalysisObject[], canvas: AnalysisCanvas): string[] {
  const out: string[] = []
  for (const o of items) {
    const sides: string[] = []
    if (o.left < -OUT_OF_BOUNDS_TOLERANCE) sides.push(`${Math.round(-o.left)}px past the left edge`)
    if (o.top < -OUT_OF_BOUNDS_TOLERANCE) sides.push(`${Math.round(-o.top)}px past the top edge`)
    if (right(o) > canvas.width + OUT_OF_BOUNDS_TOLERANCE) {
      sides.push(`${Math.round(right(o) - canvas.width)}px past the right edge`)
    }
    if (bottom(o) > canvas.height + OUT_OF_BOUNDS_TOLERANCE) {
      sides.push(`${Math.round(bottom(o) - canvas.height)}px past the bottom edge`)
    }
    if (sides.length > 0) out.push(`${label(o)} sits ${sides.join(' and ')}.`)
  }
  return out
}

const EDGES: Array<{ name: string; of: (o: AnalysisObject) => number }> = [
  { name: 'left edges', of: o => o.left },
  { name: 'right edges', of: right },
  { name: 'horizontal centres', of: centerX },
  { name: 'top edges', of: o => o.top },
  { name: 'bottom edges', of: bottom },
  { name: 'vertical centres', of: centerY },
]

function findNearMisses(items: AnalysisObject[]): string[] {
  const out: string[] = []
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i]
      const b = items[j]
      let closest: { name: string; gap: number } | null = null
      for (const edge of EDGES) {
        const gap = Math.abs(edge.of(a) - edge.of(b))
        // An exact match is alignment, not a defect.
        if (gap < NEAR_MISS_MIN || gap > NEAR_MISS_MAX) continue
        if (!closest || gap < closest.gap) closest = { name: edge.name, gap }
      }
      if (closest) {
        out.push(
          `${label(a)} and ${label(b)} have ${closest.name} ${closest.gap.toFixed(1)}px apart - ` +
            'close enough to look like a mistake rather than a choice.',
        )
      }
    }
  }
  return out
}

/** The colour sitting behind a text object: the largest filled thing under it. */
function backdropFor(
  target: AnalysisObject,
  all: AnalysisObject[],
  canvas: AnalysisCanvas,
): string | null {
  const index = all.indexOf(target)
  const beneath = all
    .slice(0, index)
    .filter(o => o.visible && o.opacity > 0 && o.fill && intersectionArea(o, target) > 0)
  if (beneath.length === 0) return canvas.background
  return beneath.reduce((big, o) => (area(o) > area(big) ? o : big)).fill
}

function findContrastProblems(
  items: AnalysisObject[],
  all: AnalysisObject[],
  canvas: AnalysisCanvas,
): string[] {
  const out: string[] = []
  for (const o of items) {
    if (o.kind !== 'text' || !o.text) continue
    const fg = parseCssColor(o.fill)
    const bg = parseCssColor(backdropFor(o, all, canvas))
    // Colour parsing is unavailable off-DOM, and a transparent backdrop tells
    // us nothing about what is actually behind the text.
    if (!fg || !bg || fg.a === 0 || bg.a === 0) continue
    const ratio = contrastRatio(fg, bg)
    const large = (o.fontSize ?? 0) >= 32
    const required = large ? 3 : 4.5
    if (ratio >= required) continue
    out.push(
      `${label(o)} has a contrast ratio of ${ratio.toFixed(1)}:1 against what sits behind it, ` +
        `below the ${required}:1 needed for ${large ? 'large' : 'body'} text.`,
    )
  }
  return out
}

/** Human-readable layout report, written to be read by a model. */
export function describeLayout(objects: AnalysisObject[], canvas: AnalysisCanvas): string {
  if (objects.length === 0) return 'The canvas is empty, so there is nothing to check.'

  const items = considered(objects, canvas)
  if (items.length === 0) {
    return 'Only a background is present, so there is no layout to check yet.'
  }

  const backgroundGaps = findBackgroundGaps(objects, canvas)
  const overlaps = findOverlaps(items)
  const outOfBounds = findOutOfBounds(items, canvas)
  const nearMisses = findNearMisses(items)
  const contrast = findContrastProblems(items, objects, canvas)
  const total =
    backgroundGaps.length +
    overlaps.length +
    outOfBounds.length +
    nearMisses.length +
    contrast.length

  const sections: string[] = []
  const section = (title: string, lines: string[]) => {
    if (lines.length === 0) return
    sections.push([title, ...lines.map(l => `  - ${l}`)].join('\n'))
  }

  if (total === 0) {
    const parts = [
      `Checked ${items.length} object(s) on a ${canvas.width}x${canvas.height} canvas.`,
      '',
      'The background covers the canvas, nothing overlaps, everything sits inside',
      'the frame, edges are either aligned or clearly apart, and all text passes',
      'contrast against its backdrop.',
    ]
    const rotated = items.filter(o => o.angle !== 0).length
    if (rotated > 0) {
      parts.push(
        '',
        `Note: ${rotated} object(s) are rotated. These checks use upright bounding`,
        'boxes, so a rotated object is treated as slightly larger than it looks.',
      )
    }
    return parts.join('\n')
  }

  sections.push(
    `Found ${total} thing(s) worth looking at on a ${canvas.width}x${canvas.height} canvas:`,
  )
  section('\nBackground:', backgroundGaps)
  section('\nOutside the frame:', outOfBounds)
  section('\nOverlapping:', overlaps)
  section('\nNearly aligned:', nearMisses)
  section('\nHard to read:', contrast)

  const rotated = items.filter(o => o.angle !== 0).length
  if (rotated > 0) {
    sections.push(
      `\nNote: ${rotated} object(s) are rotated. These checks use upright bounding boxes, ` +
        'so a rotated object is treated as slightly larger than it looks.',
    )
  }
  return sections.join('\n')
}
