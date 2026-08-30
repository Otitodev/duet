/**
 * Readable object ids for the agent-facing tool boundary.
 *
 * Avnac identifies objects with `crypto.randomUUID()`. A UUID is pure friction
 * for an agent: it has to carry the string across several tool calls, and a
 * single wrong character produces a silent miss. So the tool layer speaks in
 * `text_1` / `rect_2` aliases and translates at the edge. Nothing inside the
 * editor ever sees an alias, and no upstream id is rewritten.
 *
 * Aliases are derived from document order, so they are stable for a given
 * scene and are rebuilt whenever the document changes.
 */

import type { SceneObjectType } from './avnac-scene'

/**
 * Minimal shape the alias map needs. Kept loose so both `SceneObject` (which
 * has `type`) and an adapted `AiObjectSummary` (which has `kind`) can be
 * passed without either side converting first.
 */
export type AliasableObject = { id: string; type: string }

const PREFIX: Record<SceneObjectType, string> = {
  rect: 'rect',
  ellipse: 'ellipse',
  polygon: 'polygon',
  star: 'star',
  line: 'line',
  arrow: 'arrow',
  text: 'text',
  image: 'image',
  icon: 'icon',
  'vector-board': 'vector',
  group: 'group',
}

export type AliasMap = {
  /** Real object id -> alias. */
  readonly toAlias: ReadonlyMap<string, string>
  /** Alias -> real object id. */
  readonly toId: ReadonlyMap<string, string>
  /** Every alias, in document order. */
  readonly aliases: readonly string[]
}

export function buildAliasMap(objects: readonly AliasableObject[]): AliasMap {
  const toAlias = new Map<string, string>()
  const toId = new Map<string, string>()
  const aliases: string[] = []
  const counters = new Map<string, number>()

  for (const obj of objects) {
    const prefix = PREFIX[obj.type as SceneObjectType] ?? 'object'
    const n = (counters.get(prefix) ?? 0) + 1
    counters.set(prefix, n)
    const alias = `${prefix}_${n}`
    toAlias.set(obj.id, alias)
    toId.set(alias, obj.id)
    aliases.push(alias)
  }

  return { toAlias, toId, aliases }
}

/**
 * Resolve an agent-supplied identifier to a real object id.
 *
 * Accepts an alias or a raw object id — an agent that read an id from
 * somewhere else should not be punished for echoing it back. Returns null when
 * it matches nothing, so callers can return a useful message instead of
 * throwing.
 */
export function resolveAlias(map: AliasMap, value: string): string | null {
  const key = value.trim()
  if (!key) return null
  const byAlias = map.toId.get(key)
  if (byAlias) return byAlias
  if (map.toAlias.has(key)) return key
  const lower = key.toLowerCase()
  const byLower = map.toId.get(lower)
  return byLower ?? null
}

/** Alias for a real object id, falling back to the id when unmapped. */
export function aliasFor(map: AliasMap, id: string): string {
  return map.toAlias.get(id) ?? id
}

/**
 * Message for an identifier that resolved to nothing. The tool contract says
 * errors are returned as text and must teach the agent what to try instead, so
 * this always lists what does exist.
 */
export function unknownIdMessage(map: AliasMap, value: string): string {
  if (map.aliases.length === 0) {
    return `No object called "${value}". The canvas is empty.`
  }
  return `No object called "${value}". Objects on the canvas: ${map.aliases.join(', ')}.`
}
