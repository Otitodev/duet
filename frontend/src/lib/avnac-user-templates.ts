/**
 * Templates captured from the canvas, alongside the six built into the bundle.
 *
 * Built-in templates are TypeScript compiled into the app, so adding one means
 * editing source and redeploying. This lets a person design a layout by hand and
 * have `list_templates` and `apply_template` see it immediately.
 *
 * These live only in this browser. `templateSourceCode` exists so a good one can
 * be promoted into `src/data/templates.ts` and shipped to everyone.
 *
 * Same module-singleton shape as `avnac-uploads.ts` and `avnac-activity.ts`.
 */

import type { AvnacDocument } from './avnac-document'
import { openDb, USER_TEMPLATES_STORE } from './avnac-editor-idb'
import type { SceneObject } from './avnac-scene'

export type AvnacUserTemplate = {
  id: string
  name: string
  occasion: string
  width: number
  height: number
  document: AvnacDocument
  savedAt: number
}

export const MAX_USER_TEMPLATES = 20

let templates: AvnacUserTemplate[] = []
let hydrated = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeUserTemplates(listener: () => void): () => void {
  listeners.add(listener)
  if (!hydrated) {
    hydrated = true
    void hydrate()
  }
  return () => {
    listeners.delete(listener)
  }
}

export function getUserTemplates(): AvnacUserTemplate[] {
  return templates
}

async function hydrate(): Promise<void> {
  try {
    const rows = await readAll()
    templates = rows.sort((a, b) => b.savedAt - a.savedAt)
    emit()
  } catch {
    // An unavailable database leaves only the built-in templates. The tools
    // still work; there are simply fewer choices.
  }
}

/**
 * The tool layer has no React lifecycle, so `list_templates` calls this before
 * reading. Without it the first call after a reload misses every saved template.
 */
export async function ensureUserTemplatesLoaded(): Promise<AvnacUserTemplate[]> {
  if (!hydrated) {
    hydrated = true
    await hydrate()
  }
  return templates
}

function readAll(): Promise<AvnacUserTemplate[]> {
  return openDb().then(
    db =>
      new Promise<AvnacUserTemplate[]>((resolve, reject) => {
        const tx = db.transaction(USER_TEMPLATES_STORE, 'readonly')
        tx.onerror = () => reject(tx.error ?? new Error('templates read failed'))
        const req = tx.objectStore(USER_TEMPLATES_STORE).getAll()
        req.onerror = () => reject(req.error ?? new Error('templates getAll failed'))
        req.onsuccess = () => resolve((req.result as AvnacUserTemplate[]) ?? [])
      }),
  )
}

/**
 * Fill in missing semantic roles.
 *
 * Roles are how an agent says "retitle every heading" instead of guessing at
 * ids, so a template without them is much less useful. A hand-designed canvas
 * usually has none.
 *
 * Only ever fills gaps: a role the person or the agent already set is left
 * exactly as it is.
 */
export function guessRoles(objects: readonly SceneObject[], artboardArea: number): SceneObject[] {
  const texts = objects
    .filter(o => o.type === 'text' && !o.role)
    .sort((a, b) => {
      const sizeA = a.type === 'text' ? a.fontSize : 0
      const sizeB = b.type === 'text' ? b.fontSize : 0
      return sizeB - sizeA
    })

  const headline = texts[0]?.id
  const subhead = texts[1]?.id

  return objects.map(o => {
    if (o.role) return o
    if (o.type === 'text') {
      if (o.id === headline) return { ...o, role: 'headline' }
      if (o.id === subhead) return { ...o, role: 'subhead' }
      return { ...o, role: 'body' }
    }
    if (o.type === 'image') return { ...o, role: 'image-slot' }
    if (o.type === 'rect') {
      // A rectangle covering essentially the whole artboard is the backdrop,
      // not decoration. Layout analysis excludes these from its checks, so
      // getting it wrong makes describe_layout report one false overlap per
      // object on an otherwise clean design.
      const covers = (o.width * o.height) / Math.max(1, artboardArea) >= 0.95
      return { ...o, role: covers ? 'background' : 'accent' }
    }
    return o
  })
}

/** Slug from a name, so ids stay readable in tool output. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || 'template'
}

export type SaveTemplateResult =
  | { ok: true; template: AvnacUserTemplate }
  | { ok: false; reason: string }

/**
 * Capture a document as a template.
 *
 * Ids are prefixed so a saved template can never collide with a built-in one,
 * and so tool output makes the difference obvious.
 */
export async function saveUserTemplate(input: {
  name: string
  occasion: string
  document: AvnacDocument
}): Promise<SaveTemplateResult> {
  const name = input.name.trim()
  if (!name) return { ok: false, reason: 'A template needs a name.' }

  await ensureUserTemplatesLoaded()
  if (templates.length >= MAX_USER_TEMPLATES) {
    return {
      ok: false,
      reason: `You already have ${MAX_USER_TEMPLATES} saved templates. Delete one first.`,
    }
  }

  const { artboard } = input.document
  const objects = guessRoles(input.document.objects, artboard.width * artboard.height)

  let id = `user-${slugify(name)}`
  let n = 2
  while (templates.some(t => t.id === id)) {
    id = `user-${slugify(name)}-${n}`
    n += 1
  }

  const template: AvnacUserTemplate = {
    id,
    name,
    occasion: input.occasion.trim() || `A layout saved from this canvas: ${name}.`,
    width: artboard.width,
    height: artboard.height,
    document: { ...input.document, objects },
    savedAt: Date.now(),
  }

  templates = [template, ...templates]
  emit()

  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(USER_TEMPLATES_STORE, 'readwrite')
      tx.onerror = () => reject(tx.error ?? new Error('template write failed'))
      tx.oncomplete = () => resolve()
      tx.objectStore(USER_TEMPLATES_STORE).put(template)
    })
  } catch {
    // Usable this session even if it did not persist.
  }
  return { ok: true, template }
}

export async function deleteUserTemplate(id: string): Promise<boolean> {
  await ensureUserTemplatesLoaded()
  if (!templates.some(t => t.id === id)) return false
  templates = templates.filter(t => t.id !== id)
  emit()
  try {
    const db = await openDb()
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(USER_TEMPLATES_STORE, 'readwrite')
      tx.onerror = () => reject(tx.error ?? new Error('template delete failed'))
      tx.oncomplete = () => resolve()
      tx.objectStore(USER_TEMPLATES_STORE).delete(id)
    })
  } catch {
    // Gone for this session either way.
  }
  return true
}

/** Escape a value for a single-quoted TypeScript string literal. */
function quote(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
}

/**
 * Source ready to paste into `src/data/templates.ts`.
 *
 * A saved template lives only in this browser, so it is not in the build a
 * visitor loads. This is how a good one gets promoted into the shipped set.
 */
export function templateSourceCode(template: AvnacUserTemplate): string {
  const id = template.id.replace(/^user-/, '')
  const doc = JSON.stringify(
    {
      v: 2,
      artboard: { width: template.width, height: template.height },
      bg: template.document.bg,
      objects: template.document.objects,
    },
    null,
    2,
  )
  return [
    '  fromDocument(',
    `    '${quote(id)}',`,
    `    '${quote(template.name)}',`,
    `    '${quote(template.occasion)}',`,
    `    ${doc.split('\n').join('\n    ')},`,
    '  ),',
  ].join('\n')
}
