import { describe, expect, it } from 'vitest'
import { MAX_UPLOAD_BYTES, uploadAlias, uploadRejectionReason } from '../lib/avnac-uploads'
import { guessRoles, templateSourceCode } from '../lib/avnac-user-templates'
import { parseAvnacDocument, type SceneObject } from '../lib/avnac-scene'

const solid = { type: 'solid' as const, color: '#000000' }
const transparent = { type: 'solid' as const, color: 'transparent' }

const W = 1080
const H = 1350

function rect(id: string, width: number, height: number, role?: string): SceneObject {
  return {
    id,
    type: 'rect',
    x: 0,
    y: 0,
    width,
    height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blurPct: 0,
    shadow: null,
    role,
    fill: solid,
    stroke: transparent,
    strokeWidth: 0,
    cornerRadius: 0,
  }
}

function text(id: string, fontSize: number, role?: string): SceneObject {
  return {
    id,
    type: 'text',
    x: 80,
    y: 80,
    width: 920,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    blurPct: 0,
    shadow: null,
    role,
    text: 'Hello',
    fill: solid,
    stroke: transparent,
    strokeWidth: 0,
    fontFamily: 'Inter',
    fontSize,
    letterSpacing: 0,
    fontWeight: 400,
    fontStyle: 'normal',
    underline: false,
    textAlign: 'left',
  }
}

const AREA = W * H

describe('role guessing on capture', () => {
  it('calls a full-bleed rectangle the background and a small one an accent', () => {
    const roles = guessRoles([rect('bg', W, H), rect('bar', 160, 10)], AREA)
    expect(roles[0].role).toBe('background')
    expect(roles[1].role).toBe('accent')
  })

  it('ranks text by font size into headline, subhead, then body', () => {
    const roles = guessRoles([text('a', 32), text('b', 96), text('c', 48)], AREA)
    expect(roles.find(o => o.id === 'b')?.role).toBe('headline')
    expect(roles.find(o => o.id === 'c')?.role).toBe('subhead')
    expect(roles.find(o => o.id === 'a')?.role).toBe('body')
  })

  it('never overwrites a role that is already set', () => {
    const roles = guessRoles([rect('bg', W, H, 'accent'), text('t', 96, 'body')], AREA)
    expect(roles[0].role).toBe('accent')
    expect(roles[1].role).toBe('body')
  })

  it('ignores objects that already have roles when ranking the rest', () => {
    // The 96px text is spoken for, so the 48px one is the largest left.
    const roles = guessRoles([text('taken', 96, 'body'), text('free', 48)], AREA)
    expect(roles.find(o => o.id === 'free')?.role).toBe('headline')
  })

  it('treats a rectangle at exactly the 95% threshold as the background', () => {
    const roles = guessRoles([rect('nearly', W, Math.round(H * 0.95))], AREA)
    expect(roles[0].role).toBe('background')
  })
})

describe('upload limits', () => {
  it('refuses a file over the ceiling, naming it and the limit', () => {
    const reason = uploadRejectionReason(MAX_UPLOAD_BYTES + 1, 'huge.png')
    expect(reason).toContain('huge.png')
    expect(reason).toContain('8MB')
  })

  it('accepts a file at the ceiling', () => {
    expect(uploadRejectionReason(MAX_UPLOAD_BYTES, 'fine.png')).toBeNull()
  })

  it('numbers aliases from one, matching how objects are aliased', () => {
    expect(uploadAlias(0)).toBe('upload_1')
    expect(uploadAlias(4)).toBe('upload_5')
  })
})

describe('template source code', () => {
  const template = {
    id: 'user-wedding',
    name: 'Wedding invite',
    occasion: 'Weddings and formal invitations.',
    width: W,
    height: H,
    document: {
      v: 2,
      artboard: { width: W, height: H },
      bg: solid,
      objects: [rect('bg', W, H, 'background')],
    },
    savedAt: 0,
  } as Parameters<typeof templateSourceCode>[0]

  it('drops the user- prefix so the id reads like a built-in', () => {
    expect(templateSourceCode(template)).toContain("'wedding'")
  })

  it('emits a fromDocument call carrying the objects', () => {
    const code = templateSourceCode(template)
    expect(code.startsWith('  fromDocument(')).toBe(true)
    expect(code).toContain('"role": "background"')
  })

  it('escapes an apostrophe so the literal still compiles', () => {
    const code = templateSourceCode({ ...template, name: "Mum's birthday" })
    expect(code).toContain("'Mum\\'s birthday'")
  })

  it('produces a document the app will accept', () => {
    expect(parseAvnacDocument(template.document)).not.toBeNull()
  })
})
