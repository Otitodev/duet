import { describe, expect, it } from 'vitest'
import {
  type AnalysisCanvas,
  type AnalysisObject,
  contrastRatio,
  describeLayout,
  relativeLuminance,
} from '../lib/avnac-layout-analysis'

const CANVAS: AnalysisCanvas = { width: 1080, height: 1350, background: '#ffffff' }

function obj(alias: string, over: Partial<AnalysisObject> = {}): AnalysisObject {
  return {
    alias,
    role: null,
    kind: 'rect',
    left: 80,
    top: 100,
    width: 200,
    height: 100,
    angle: 0,
    fill: '#000000',
    text: null,
    fontSize: null,
    opacity: 1,
    visible: true,
    ...over,
  }
}

/** A full-bleed background plus two well-behaved objects. */
function cleanScene(): AnalysisObject[] {
  return [
    obj('rect_1', { role: 'background', left: 0, top: 0, width: 1080, height: 1350 }),
    obj('text_1', { role: 'headline', kind: 'text', top: 300, text: 'Hello', fontSize: 96 }),
    obj('text_2', { role: 'body', kind: 'text', top: 600, text: 'World', fontSize: 32 }),
  ]
}

describe('describeLayout', () => {
  it('reports no problems on a clean template', () => {
    const out = describeLayout(cleanScene(), CANVAS)
    expect(out).toContain('nothing overlaps')
    expect(out).not.toContain('worth looking at')
  })

  it('does not count the full-bleed background as overlapping everything', () => {
    // The trap: a naive pairwise check reports one overlap per object here.
    const out = describeLayout(cleanScene(), CANVAS)
    expect(out).not.toContain('Overlapping')
    expect(out).not.toContain('rect_1')
  })

  it('ignores an object that covers the whole canvas even without the role', () => {
    const scene = cleanScene()
    scene[0] = obj('rect_1', { left: 0, top: 0, width: 1080, height: 1350 })
    expect(describeLayout(scene, CANVAS)).not.toContain('worth looking at')
  })

  it('flags a background that no longer covers the canvas', () => {
    // The case that actually occurs in the demo: the canvas grows, the
    // background does not, and a bare strip appears that no other check sees.
    const out = describeLayout(cleanScene(), { ...CANVAS, height: 1920 })
    expect(out).toContain('Background')
    expect(out).toContain('no longer covers the canvas')
    expect(out).toContain('rect_1')
  })

  it('does not flag a background that still covers the canvas', () => {
    expect(describeLayout(cleanScene(), CANVAS)).not.toContain('no longer covers')
  })

  it('names an object that falls outside the frame', () => {
    const scene = cleanScene()
    scene.push(obj('rect_2', { left: 1000, top: 100, width: 300, height: 100 }))
    const out = describeLayout(scene, CANVAS)
    expect(out).toContain('Outside the frame')
    expect(out).toContain('rect_2')
    expect(out).toContain('past the right edge')
  })

  it('never flags a background that sits exactly on the edge', () => {
    expect(describeLayout(cleanScene(), CANVAS)).not.toContain('Outside the frame')
  })

  it('reports a near-miss but not an exact alignment', () => {
    const near = cleanScene()
    near.push(obj('rect_2', { left: 83, top: 900 }))
    expect(describeLayout(near, CANVAS)).toContain('Nearly aligned')

    const exact = cleanScene()
    exact.push(obj('rect_2', { left: 80, top: 900 }))
    expect(describeLayout(exact, CANVAS)).not.toContain('Nearly aligned')
  })

  it('reports a real overlap between two content objects', () => {
    const scene = cleanScene()
    scene.push(obj('rect_2', { left: 80, top: 310, width: 200, height: 100 }))
    const out = describeLayout(scene, CANVAS)
    expect(out).toContain('Overlapping')
    expect(out).toContain('rect_2')
  })

  it('skips hidden and fully transparent objects', () => {
    const hidden = cleanScene()
    hidden.push(obj('rect_2', { left: 5000, top: 5000, visible: false }))
    expect(describeLayout(hidden, CANVAS)).not.toContain('rect_2')

    const clear = cleanScene()
    clear.push(obj('rect_3', { left: 5000, top: 5000, opacity: 0 }))
    expect(describeLayout(clear, CANVAS)).not.toContain('rect_3')
  })

  it('mentions rotation, since the checks use upright boxes', () => {
    const scene = cleanScene()
    scene.push(obj('rect_2', { top: 900, angle: 45 }))
    expect(describeLayout(scene, CANVAS)).toContain('rotated')
  })

  it('handles an empty canvas and a background-only canvas distinctly', () => {
    expect(describeLayout([], CANVAS)).toContain('empty')
    const bgOnly = [
      obj('rect_1', { role: 'background', left: 0, top: 0, width: 1080, height: 1350 }),
    ]
    expect(describeLayout(bgOnly, CANVAS)).toContain('no layout to check')
  })
})

describe('contrast maths', () => {
  const white = { r: 255, g: 255, b: 255, a: 1 }
  const black = { r: 0, g: 0, b: 0, a: 1 }

  it('matches the WCAG reference values', () => {
    expect(relativeLuminance(white)).toBeCloseTo(1, 5)
    expect(relativeLuminance(black)).toBeCloseTo(0, 5)
    expect(contrastRatio(black, white)).toBeCloseTo(21, 5)
  })

  it('is symmetric and bottoms out at 1 for identical colours', () => {
    expect(contrastRatio(white, black)).toBeCloseTo(contrastRatio(black, white), 10)
    expect(contrastRatio(white, white)).toBeCloseTo(1, 10)
  })
})
