import { describe, expect, it } from 'vitest'
import {
  aliasFor,
  buildAliasMap,
  resolveAlias,
  unknownIdMessage,
} from '../lib/avnac-ai-aliases'
import { reflowObjectsForArtboard } from '../lib/avnac-ai-transforms'
import { parseAvnacDocument, type SceneObject } from '../lib/avnac-scene'

const solidBlack = { type: 'solid' as const, color: '#000000' }
const transparent = { type: 'solid' as const, color: 'transparent' }

function rect(id: string, x = 0, y = 0, width = 100, height = 100): SceneObject {
  return {
    id,
    type: 'rect',
    x,
    y,
    width,
    height,
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

function ellipse(id: string): SceneObject {
  return { ...rect(id), type: 'ellipse' } as SceneObject
}

describe('alias map', () => {
  it('numbers each type independently, in document order', () => {
    const map = buildAliasMap([rect('a'), ellipse('b'), rect('c')])
    expect(map.aliases).toEqual(['rect_1', 'ellipse_1', 'rect_2'])
    expect(aliasFor(map, 'c')).toBe('rect_2')
  })

  it('round-trips an alias back to the real id', () => {
    const map = buildAliasMap([rect('uuid-a'), rect('uuid-b')])
    expect(resolveAlias(map, 'rect_2')).toBe('uuid-b')
  })

  it('accepts a raw object id, so echoing one back is not punished', () => {
    const map = buildAliasMap([rect('uuid-a')])
    expect(resolveAlias(map, 'uuid-a')).toBe('uuid-a')
  })

  it('returns null for an unknown id rather than throwing', () => {
    const map = buildAliasMap([rect('uuid-a')])
    expect(resolveAlias(map, 'text_9')).toBeNull()
  })

  it('lists what does exist when an id misses', () => {
    const map = buildAliasMap([rect('a'), ellipse('b')])
    expect(unknownIdMessage(map, 'text_9')).toContain('rect_1, ellipse_1')
  })

  it('says so plainly when the canvas is empty', () => {
    expect(unknownIdMessage(buildAliasMap([]), 'rect_1')).toContain('empty')
  })
})

describe('artboard reflow', () => {
  const from = { width: 1000, height: 1000 }

  it('leaves objects untouched for keep_positions', () => {
    const objects = [rect('a', 10, 20)]
    const out = reflowObjectsForArtboard(objects, from, { width: 500, height: 500 }, 'keep_positions')
    expect(out).toBe(objects)
  })

  it('stretches to the new proportions for scale', () => {
    const out = reflowObjectsForArtboard(
      [rect('a', 100, 100, 200, 200)],
      from,
      { width: 2000, height: 500 },
      'scale',
    )
    expect(out[0].x).toBe(200)
    expect(out[0].y).toBe(50)
    expect(out[0].width).toBe(400)
    expect(out[0].height).toBe(100)
  })

  it('scales uniformly and centres for fit', () => {
    // 1000x1000 -> 2000x500 gives a uniform factor of 0.5.
    const out = reflowObjectsForArtboard(
      [rect('a', 0, 0, 1000, 1000)],
      from,
      { width: 2000, height: 500 },
      'fit',
    )
    expect(out[0].width).toBe(500)
    expect(out[0].height).toBe(500)
    // Centred horizontally in the wider frame.
    expect(out[0].x).toBe(750)
    expect(out[0].y).toBe(0)
  })

  it('survives an empty scene and a degenerate source size', () => {
    expect(reflowObjectsForArtboard([], from, { width: 500, height: 500 }, 'fit')).toEqual([])
    const objects = [rect('a')]
    expect(
      reflowObjectsForArtboard(objects, { width: 0, height: 0 }, { width: 500, height: 500 }, 'fit'),
    ).toBe(objects)
  })
})

describe('role field', () => {
  it('survives a save and load round-trip', () => {
    const doc = {
      v: 2,
      artboard: { width: 1080, height: 1350 },
      bg: solidBlack,
      objects: [{ ...rect('a'), role: 'headline' }],
    }
    const parsed = parseAvnacDocument(JSON.parse(JSON.stringify(doc)))
    expect(parsed).not.toBeNull()
    expect(parsed?.objects[0].role).toBe('headline')
  })

  it('drops a blank role rather than storing an empty string', () => {
    const doc = {
      v: 2,
      artboard: { width: 1080, height: 1350 },
      bg: solidBlack,
      objects: [{ ...rect('a'), role: '   ' }],
    }
    const parsed = parseAvnacDocument(JSON.parse(JSON.stringify(doc)))
    expect(parsed?.objects[0].role).toBeUndefined()
  })
})
