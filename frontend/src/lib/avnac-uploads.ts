/**
 * The person's image library.
 *
 * Uploads are stored so they survive a reload, and exposed to the agent, which
 * is the whole reason this exists: "put my photo in the flyer" only works if
 * the agent can see what the person has actually put into the editor. That is
 * the same in-page advantage `get_selection` argues for, applied to files.
 *
 * The store is a module singleton with subscribe/getSnapshot rather than React
 * state, because the panel and the tool layer live in different worlds and need
 * the same list. Same shape as `avnac-proposals.ts` and `avnac-activity.ts`.
 */

import { openDb, UPLOADS_STORE } from './avnac-editor-idb'

export type AvnacUpload = {
  id: string
  /** Original file name, shown to the person and to the agent. */
  name: string
  dataUrl: string
  width: number
  height: number
  bytes: number
  addedAt: number
}

/**
 * Per-file ceiling. Large enough for a phone photo, small enough that thirty of
 * them do not make the database unwieldy.
 */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024

/** Oldest are dropped past this, so a long session cannot grow without bound. */
export const MAX_UPLOADS = 30

let uploads: AvnacUpload[] = []
let hydrated = false
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function subscribeUploads(listener: () => void): () => void {
  listeners.add(listener)
  // Hydration is lazy: nothing reads uploads until a panel opens or a tool asks.
  if (!hydrated) {
    hydrated = true
    void hydrate()
  }
  return () => {
    listeners.delete(listener)
  }
}

/** Stable reference between changes, so useSyncExternalStore does not loop. */
export function getUploads(): AvnacUpload[] {
  return uploads
}

async function hydrate(): Promise<void> {
  try {
    const rows = await readAll()
    uploads = rows.sort((a, b) => b.addedAt - a.addedAt)
    emit()
  } catch {
    // A blocked or unavailable database leaves the library empty rather than
    // breaking the editor. Uploads are a convenience, not the document.
  }
}

/**
 * Make sure the library is loaded before reading it.
 *
 * The tool layer has no React lifecycle to hang hydration off, so `list_uploads`
 * calls this first. Without it the first tool call after a reload reports an
 * empty library that is not empty.
 */
export async function ensureUploadsLoaded(): Promise<AvnacUpload[]> {
  if (!hydrated) {
    hydrated = true
    await hydrate()
  }
  return uploads
}

function readAll(): Promise<AvnacUpload[]> {
  return openDb().then(
    db =>
      new Promise<AvnacUpload[]>((resolve, reject) => {
        const tx = db.transaction(UPLOADS_STORE, 'readonly')
        tx.onerror = () => reject(tx.error ?? new Error('uploads read failed'))
        const req = tx.objectStore(UPLOADS_STORE).getAll()
        req.onerror = () => reject(req.error ?? new Error('uploads getAll failed'))
        req.onsuccess = () => resolve((req.result as AvnacUpload[]) ?? [])
      }),
  )
}

async function write(record: AvnacUpload): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(UPLOADS_STORE, 'readwrite')
    tx.onerror = () => reject(tx.error ?? new Error('upload write failed'))
    tx.oncomplete = () => resolve()
    tx.objectStore(UPLOADS_STORE).put(record)
  })
}

async function remove(id: string): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(UPLOADS_STORE, 'readwrite')
    tx.onerror = () => reject(tx.error ?? new Error('upload delete failed'))
    tx.oncomplete = () => resolve()
    tx.objectStore(UPLOADS_STORE).delete(id)
  })
}

/** Why an upload was refused, or null when it is fine. */
export function uploadRejectionReason(bytes: number, name: string): string | null {
  if (bytes > MAX_UPLOAD_BYTES) {
    const mb = (bytes / (1024 * 1024)).toFixed(1)
    return `${name} is ${mb}MB. The limit is ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB per image.`
  }
  return null
}

export type AddUploadResult =
  | { ok: true; upload: AvnacUpload; dropped: number }
  | { ok: false; reason: string }

/**
 * Add one image to the library.
 *
 * Returns a reason rather than throwing, so a caller can report it to a person
 * or an agent in words.
 */
export async function addUpload(input: {
  name: string
  dataUrl: string
  width: number
  height: number
  bytes: number
}): Promise<AddUploadResult> {
  const reason = uploadRejectionReason(input.bytes, input.name)
  if (reason) return { ok: false, reason }

  const upload: AvnacUpload = {
    id: crypto.randomUUID(),
    name: input.name,
    dataUrl: input.dataUrl,
    width: Math.round(input.width),
    height: Math.round(input.height),
    bytes: input.bytes,
    addedAt: Date.now(),
  }

  await ensureUploadsLoaded()
  const next = [upload, ...uploads]
  const overflow = next.slice(MAX_UPLOADS)
  uploads = next.slice(0, MAX_UPLOADS)
  emit()

  try {
    await write(upload)
    for (const old of overflow) await remove(old.id)
  } catch {
    // The in-memory list already reflects the add, so the image still works for
    // this session even when persistence fails.
  }
  return { ok: true, upload, dropped: overflow.length }
}

export async function deleteUpload(id: string): Promise<boolean> {
  await ensureUploadsLoaded()
  if (!uploads.some(u => u.id === id)) return false
  uploads = uploads.filter(u => u.id !== id)
  emit()
  try {
    await remove(id)
  } catch {
    // Gone from the session either way; it may reappear on the next reload.
  }
  return true
}

/** Readable ids at the tool boundary, matching how objects are aliased. */
export function uploadAlias(index: number): string {
  return `upload_${index + 1}`
}

export function resolveUploadAlias(raw: string): AvnacUpload | null {
  const wanted = raw.trim().toLowerCase()
  const byAlias = uploads.findIndex((_, i) => uploadAlias(i) === wanted)
  if (byAlias !== -1) return uploads[byAlias]
  return uploads.find(u => u.id === raw.trim()) ?? null
}
