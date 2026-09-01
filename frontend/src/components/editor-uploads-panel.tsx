import { Cancel01Icon, Delete02Icon, ImageAdd01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { type DragEvent, useRef, useState, useSyncExternalStore } from 'react'

import {
  addUpload,
  deleteUpload,
  getUploads,
  subscribeUploads,
  uploadAlias,
  uploadRejectionReason,
} from '../lib/avnac-uploads'
import {
  editorSidebarPanelLeftClass,
  editorSidebarPanelTopClass,
} from '../lib/editor-sidebar-panel-layout'
import { fileToDataUrl, isImageFile } from '../scene-engine/primitives'
import { useAiController } from './scene-editor/ai-controller-context'

type Props = {
  open: boolean
  onClose: () => void
}

/** Natural size, so both the stored record and the agent know the shape. */
function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise(resolve => {
    const img = new Image()
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight })
    // A file that will not decode is still stored; placement then falls back to
    // the editor's own defaults rather than the panel refusing it outright.
    img.onerror = () => resolve({ width: 0, height: 0 })
    img.src = dataUrl
  })
}

export default function EditorUploadsPanel({ open, onClose }: Props) {
  const controller = useAiController()
  const uploads = useSyncExternalStore(subscribeUploads, getUploads, getUploads)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  async function addFiles(files: FileList | File[] | null) {
    const list = Array.from(files ?? []).filter(isImageFile)
    if (list.length === 0) return
    const problems: string[] = []
    for (const file of list) {
      const reason = uploadRejectionReason(file.size, file.name)
      if (reason) {
        problems.push(reason)
        continue
      }
      const dataUrl = await fileToDataUrl(file)
      const { width, height } = await imageSize(dataUrl)
      const result = await addUpload({ name: file.name, dataUrl, width, height, bytes: file.size })
      if (!result.ok) problems.push(result.reason)
      else if (result.dropped > 0) {
        problems.push(`Oldest ${result.dropped} upload(s) removed to stay under the limit.`)
      }
    }
    setNote(problems[0] ?? null)
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragging(false)
    void addFiles(e.dataTransfer?.files ?? null)
  }

  if (!open) return null

  return (
    <div
      data-avnac-chrome
      className={[
        'pointer-events-auto fixed z-40 flex w-[min(100vw-1.5rem,300px)] max-h-[min(92dvh,720px)] flex-col overflow-hidden rounded-3xl border border-black/[0.08] bg-white/95 backdrop-blur-md',
        editorSidebarPanelLeftClass,
        editorSidebarPanelTopClass,
      ].join(' ')}
      role="dialog"
      aria-label="Uploads"
    >
      <div className="flex items-center justify-between border-b border-black/[0.06] px-3 py-2">
        <span className="text-sm font-semibold text-neutral-800">Uploads</span>
        <button
          type="button"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-600 hover:bg-black/[0.06]"
          onClick={onClose}
          aria-label="Close uploads"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.75} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div
          onDragOver={e => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={[
            'flex flex-col items-center gap-2 rounded-2xl border border-dashed px-3 py-6 text-center transition-colors',
            dragging
              ? 'border-[var(--agent)] bg-[var(--agent-soft)]'
              : 'border-black/[0.14] bg-black/[0.015]',
          ].join(' ')}
        >
          <HugeiconsIcon
            icon={ImageAdd01Icon}
            size={22}
            strokeWidth={1.6}
            className="text-neutral-400"
          />
          <p className="text-[13px] text-neutral-600">Drop images here</p>
          <button
            type="button"
            className="rounded-lg border border-black/[0.1] bg-white px-3 py-1.5 text-[12px] font-medium text-neutral-700 hover:bg-black/[0.03]"
            onClick={() => inputRef.current?.click()}
          >
            Browse files
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={e => {
              void addFiles(e.target.files)
              // Cleared so choosing the same file twice still fires change.
              e.target.value = ''
            }}
          />
        </div>

        {note ? <p className="mt-2 text-[12px] text-neutral-500">{note}</p> : null}

        {uploads.length === 0 ? (
          <p className="mt-4 text-center text-[12px] text-neutral-400">
            Anything you add stays in this browser, and an AI agent can place it for you.
          </p>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-2">
            {uploads.map((upload, index) => (
              <div key={upload.id} className="group relative">
                <button
                  type="button"
                  onClick={() => void controller.addImageFromUrl({ url: upload.dataUrl })}
                  className="block w-full overflow-hidden rounded-xl border border-black/[0.08] bg-white hover:border-[var(--agent)]"
                  title={`Add ${upload.name} to the canvas`}
                >
                  <img
                    src={upload.dataUrl}
                    alt={upload.name}
                    className="h-20 w-full object-cover"
                  />
                </button>
                <button
                  type="button"
                  onClick={() => void deleteUpload(upload.id)}
                  className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-md bg-white/90 text-neutral-600 shadow-sm hover:text-red-600 group-hover:flex"
                  aria-label={`Delete ${upload.name}`}
                >
                  <HugeiconsIcon icon={Delete02Icon} size={13} strokeWidth={1.75} />
                </button>
                <p className="mt-1 truncate text-[11px] text-neutral-500" title={upload.name}>
                  {/* The alias is what an agent calls it, so show both. */}
                  <span className="text-neutral-400">{uploadAlias(index)}</span> {upload.name}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
