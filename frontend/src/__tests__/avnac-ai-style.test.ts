import { describe, expect, it } from 'vitest'
import { describePaint, parseAiPaint, parseGradient } from '../lib/avnac-ai-paint'
import { applyAiPatch } from '../lib/avnac-ai-transforms'
import type { SceneObject, SceneRect, SceneText } from '../lib/avnac-scene'
import { unappliedProperties, unappliedReason } from '../lib/avnac-webmcp-tools'

const solidBlack = { type: 'solid' as const, color: '#000000' }
const transparent = { type: 'solid' as const, color: 'transparent' }

function rect(): SceneRect {
  return {
    id: 'r',
    type: 'rect',
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blurPct: 0,
    shadow: null,
    fill: solidBlack,
    stroke: transparent,
    strokeWidth: 0,
    cornerRadius: 0,
  }
}

function text(): SceneText {
  return {
    id: 't',
    type: 'text',
    x: 0,
    y: 0,
    width: 400,
    height: 60,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blurPct: 0,
    shadow: null,
    text: 'Hello',
    fill: solidBlack,
    stroke: transparent,
    strokeWidth: 0,
    fontFamily: 'Inter',
    fontSize: 48,
    letterSpacing: 0,
    fontWeight: 400,
    fontStyle: 'normal',
    underline: false,
    textAlign: 'left',
  }
}

describe('gradient parsing', () => {
  it('reads an angle and positioned stops', () => {
    const value = parseGradient('linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)')
    expect(value).not.toBeNull()
    if (value?.type !== 'gradient') throw new Error('expected a gradient')
    expect(value.angle).toBe(135)
    expect(value.stops).toEqual([
      { color: '#f59e0b', offset: 0 },
      { color: '#ef4444', offset: 1 },
    ])
  })

  it('spreads unpositioned stops evenly and defaults the angle to 180', () => {
    const value = parseGradient('linear-gradient(#ff0000, #00ff00, #0000ff)')
    if (value?.type !== 'gradient') throw new Error('expected a gradient')
    expect(value.angle).toBe(180)
    expect(value.stops.map(s => s.offset)).toEqual([0, 0.5, 1])
  })

  it('accepts keyword directions', () => {
    const value = parseGradient('linear-gradient(to right, #000 0%, #fff 100%)')
    if (value?.type !== 'gradient') throw new Error('expected a gradient')
    expect(value.angle).toBe(90)
  })

  it('does not split commas inside a colour function', () => {
    const value = parseGradient('linear-gradient(90deg, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)')
    if (value?.type !== 'gradient') throw new Error('expected a gradient')
    expect(value.stops.map(s => s.color)).toEqual(['rgb(255, 0, 0)', 'rgb(0, 0, 255)'])
  })

  it('rebuilds css that round-trips', () => {
    const value = parseGradient('linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)')
    if (value?.type !== 'gradient') throw new Error('expected a gradient')
    expect(value.css).toBe('linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)')
  })

  it('rejects anything that is not a gradient, including a single stop', () => {
    expect(parseGradient('#ff0000')).toBeNull()
    expect(parseGradient('linear-gradient(#ff0000)')).toBeNull()
    expect(parseGradient('radial-gradient(#ff0000, #00ff00)')).toBeNull()
  })

  it('falls back to a solid for ordinary colours', () => {
    expect(parseAiPaint('#f59e0b')).toEqual({ type: 'solid', color: '#f59e0b' })
    expect(parseAiPaint('transparent')).toEqual({ type: 'solid', color: 'transparent' })
  })
})

describe('paint descriptions', () => {
  it('names the ends of a gradient', () => {
    expect(describePaint(parseAiPaint('linear-gradient(90deg, #000 0%, #fff 100%)'))).toBe(
      'gradient 90deg #000 to #fff',
    )
  })

  it('passes a solid straight through', () => {
    expect(describePaint(parseAiPaint('#f59e0b'))).toBe('#f59e0b')
  })
})

describe('applyAiPatch styling', () => {
  it('applies a gradient fill', () => {
    const next = applyAiPatch(rect(), {
      fill: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
    }) as SceneRect
    expect(next.fill.type).toBe('gradient')
  })

  it('sets stroke width, corner radius and blur', () => {
    const next = applyAiPatch(rect(), {
      stroke: '#ffffff',
      strokeWidth: 8,
      cornerRadius: 24,
      blurPct: 40,
    }) as SceneRect
    expect(next.strokeWidth).toBe(8)
    expect(next.cornerRadius).toBe(24)
    expect(next.blurPct).toBe(40)
  })

  it('clamps blur to 0-100 and never takes a negative stroke width', () => {
    expect((applyAiPatch(rect(), { blurPct: 400 }) as SceneRect).blurPct).toBe(100)
    expect((applyAiPatch(rect(), { strokeWidth: -5 }) as SceneRect).strokeWidth).toBe(0)
  })

  it('starts a partial shadow from the editor defaults so it is visible', () => {
    const next = applyAiPatch(rect(), { shadow: { blur: 40 } })
    expect(next.shadow).not.toBeNull()
    expect(next.shadow?.blur).toBe(40)
    expect(next.shadow?.offsetX).toBe(6)
  })

  it('merges onto an existing shadow rather than replacing it', () => {
    const withShadow = applyAiPatch(rect(), { shadow: { blur: 40, offsetX: 20 } })
    const recoloured = applyAiPatch(withShadow, { shadow: { color: '#ff0000' } })
    expect(recoloured.shadow?.offsetX).toBe(20)
    expect(recoloured.shadow?.colorHex).toBe('#ff0000')
  })

  it('removes a shadow when passed null', () => {
    const withShadow = applyAiPatch(rect(), { shadow: { blur: 40 } })
    expect(applyAiPatch(withShadow, { shadow: null }).shadow).toBeNull()
  })

  it('sets typography on text objects', () => {
    const next = applyAiPatch(text(), {
      fontFamily: 'Fraunces',
      fontWeight: 700,
      fontStyle: 'italic',
      textAlign: 'center',
    }) as SceneText
    expect(next.fontFamily).toBe('Fraunces')
    expect(next.fontWeight).toBe(700)
    expect(next.fontStyle).toBe('italic')
    expect(next.textAlign).toBe('center')
  })

  it('snaps font weight to a hundred and clamps it', () => {
    expect((applyAiPatch(text(), { fontWeight: 640 }) as SceneText).fontWeight).toBe(600)
    expect((applyAiPatch(text(), { fontWeight: 5000 }) as SceneText).fontWeight).toBe(900)
  })

  it('leaves corner radius alone on a type that has none', () => {
    const ellipse = { ...rect(), type: 'ellipse' } as unknown as SceneObject
    expect(() => applyAiPatch(ellipse, { cornerRadius: 20 })).not.toThrow()
  })
})

describe('reporting changes that cannot apply', () => {
  it('drops paint properties on a vector board, which has none', () => {
    const dropped = unappliedProperties('vector-board', { fill: '#f00', strokeWidth: 4 })
    expect(dropped).toEqual(['fill', 'strokeWidth'])
  })

  it('drops corner radius on an ellipse but keeps fill', () => {
    expect(unappliedProperties('ellipse', { cornerRadius: 20, fill: '#f00' })).toEqual([
      'cornerRadius',
    ])
  })

  it('drops fill on a line, which only has a stroke', () => {
    expect(unappliedProperties('line', { fill: '#f00', stroke: '#00f' })).toEqual(['fill'])
  })

  it('drops typography on anything that is not text', () => {
    expect(unappliedProperties('rect', { fontSize: 40, fontFamily: 'Inter', text: 'hi' })).toEqual([
      'text',
      'fontSize',
      'fontFamily',
    ])
  })

  it('drops nothing when the object supports everything asked for', () => {
    expect(unappliedProperties('text', { fill: '#f00', fontSize: 40, stroke: '#00f' })).toEqual([])
    expect(unappliedProperties('rect', { fill: '#f00', cornerRadius: 8 })).toEqual([])
  })

  it('never drops properties every object has', () => {
    const patch = { left: 1, top: 2, width: 3, height: 4, opacity: 0.5, blurPct: 10, shadow: null }
    expect(unappliedProperties('vector-board', patch)).toEqual([])
    expect(unappliedProperties('group', patch)).toEqual([])
  })

  it('explains a vector board in its own terms rather than naming a property', () => {
    expect(unappliedReason('vector-board', ['fill'])).toContain('no editable paint')
  })

  it('names the single property when an ordinary object cannot take it', () => {
    expect(unappliedReason('ellipse', ['cornerRadius'])).toBe(
      'cornerRadius was ignored: an ellipse object has no cornerRadius.',
    )
  })
})
