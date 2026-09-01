import { type Dispatch, type SetStateAction, useMemo } from 'react'
import type {
  AiDesignController,
  AiObjectKind,
  AiObjectSummary,
} from '../../lib/avnac-ai-controller'
import { describePaint, parseAiPaint } from '../../lib/avnac-ai-paint'
import {
  applyAiPatch,
  reflowObjectsForArtboard,
  remeasureTextObjects,
} from '../../lib/avnac-ai-transforms'
import {
  type AvnacDocument,
  clampTextLetterSpacing,
  getObjectCornerRadius,
  getObjectFill,
  getObjectStroke,
  getObjectStrokeWidth,
  objectDisplayName,
  objectSupportsFill,
  objectSupportsOutlineStroke,
  parseAvnacDocument,
  type SceneLine,
  type SceneObject,
  type SceneText,
} from '../../lib/avnac-scene'
import {
  layoutSceneText,
  renderAvnacDocumentToDataUrl,
  sceneTextLineHeight,
} from '../../lib/avnac-scene-render'
import type { VectorBoardDocument } from '../../lib/avnac-vector-board-document'
import { angleFromPoints } from '../../scene-engine/primitives'
import type { BgValue } from '../background-popover'

type PlaceImageObject = (
  rawUrl: string,
  opts?: {
    x?: number
    y?: number
    width?: number
    height?: number
    origin?: 'center' | 'top-left'
  },
) => Promise<string | null>

type UseAiDesignControllerArgs = {
  addObjects: (objectsToAdd: SceneObject[]) => void
  artboardH: number
  artboardW: number
  doc: AvnacDocument
  placeImageObject: PlaceImageObject
  selectedIds: string[]
  setDoc: Dispatch<SetStateAction<AvnacDocument>>
  setSelectedIds: Dispatch<SetStateAction<string[]>>
  vectorBoardDocs: Record<string, VectorBoardDocument>
}

const AI_DEFAULT_STROKE = { type: 'solid', color: 'transparent' } as const

/** Paint as a short string for the agent, or null when the object has none. */
function paintLabel(value: BgValue | null): string | null {
  return value ? describePaint(value) : null
}

function leftFromSpec(
  spec: { x?: number; origin?: 'center' | 'top-left' },
  fallbackCenter: number,
  width: number,
) {
  return spec.origin === 'top-left'
    ? (spec.x ?? fallbackCenter)
    : (spec.x ?? fallbackCenter) - width / 2
}

function topFromSpec(
  spec: { y?: number; origin?: 'center' | 'top-left' },
  fallbackCenter: number,
  height: number,
) {
  return spec.origin === 'top-left'
    ? (spec.y ?? fallbackCenter)
    : (spec.y ?? fallbackCenter) - height / 2
}

export function useAiDesignController({
  addObjects,
  artboardH,
  artboardW,
  doc,
  placeImageObject,
  selectedIds,
  setDoc,
  setSelectedIds,
  vectorBoardDocs,
}: UseAiDesignControllerArgs) {
  return useMemo<AiDesignController>(
    () => ({
      getCanvas: () => ({
        width: doc.artboard.width,
        height: doc.artboard.height,
        background: doc.bg.type === 'solid' ? doc.bg.color : doc.bg.css,
        objectCount: doc.objects.length,
        objects: doc.objects.map<AiObjectSummary>(obj => ({
          id: obj.id,
          kind:
            obj.type === 'vector-board'
              ? 'vector-board'
              : obj.type === 'group'
                ? 'group'
                : (obj.type as AiObjectKind),
          label: objectDisplayName(obj),
          role: obj.role ?? null,
          left: obj.x,
          top: obj.y,
          width: obj.width,
          height: obj.height,
          angle: obj.rotation,
          // Gradients are described rather than dropped: reporting null for a
          // gradient fill would tell the agent its own change did not land.
          fill: paintLabel(objectSupportsFill(obj) ? getObjectFill(obj) : null),
          stroke: paintLabel(objectSupportsOutlineStroke(obj) ? getObjectStroke(obj) : null),
          text: obj.type === 'text' ? obj.text : null,
          fontSize: obj.type === 'text' ? obj.fontSize : null,
          opacity: obj.opacity,
          visible: obj.visible,
          strokeWidth: getObjectStrokeWidth(obj),
          cornerRadius: getObjectCornerRadius(obj),
          fontFamily: obj.type === 'text' ? obj.fontFamily : null,
          fontWeight: obj.type === 'text' ? obj.fontWeight : null,
          textAlign: obj.type === 'text' ? obj.textAlign : null,
          hasShadow: obj.shadow !== null,
        })),
      }),
      addRectangle: spec => {
        const obj: SceneObject = {
          id: crypto.randomUUID(),
          type: 'rect',
          x: leftFromSpec(spec, artboardW / 2, spec.width),
          y: topFromSpec(spec, artboardH / 2, spec.height),
          width: spec.width,
          height: spec.height,
          rotation: spec.rotation ?? 0,
          opacity: spec.opacity ?? 1,
          visible: true,
          locked: false,
          blurPct: 0,
          shadow: null,
          fill: { type: 'solid', color: spec.fill ?? '#262626' },
          stroke: { type: 'solid', color: spec.stroke ?? 'transparent' },
          strokeWidth: spec.strokeWidth ?? 0,
          cornerRadius: spec.cornerRadius ?? 0,
        }
        addObjects([obj])
        return { id: obj.id }
      },
      addEllipse: spec => {
        const obj: SceneObject = {
          id: crypto.randomUUID(),
          type: 'ellipse',
          x: leftFromSpec(spec, artboardW / 2, spec.width),
          y: topFromSpec(spec, artboardH / 2, spec.height),
          width: spec.width,
          height: spec.height,
          rotation: spec.rotation ?? 0,
          opacity: spec.opacity ?? 1,
          visible: true,
          locked: false,
          blurPct: 0,
          shadow: null,
          fill: { type: 'solid', color: spec.fill ?? '#262626' },
          stroke: { type: 'solid', color: spec.stroke ?? 'transparent' },
          strokeWidth: spec.strokeWidth ?? 0,
        }
        addObjects([obj])
        return { id: obj.id }
      },
      addText: spec => {
        const width = spec.width ?? 320
        const fontSize = spec.fontSize ?? 64
        const obj: SceneText = {
          id: crypto.randomUUID(),
          type: 'text',
          x: leftFromSpec(spec, artboardW / 2, width),
          y: topFromSpec(spec, artboardH / 2, fontSize * 2),
          width,
          height: fontSize,
          rotation: spec.rotation ?? 0,
          opacity: spec.opacity ?? 1,
          visible: true,
          locked: false,
          blurPct: 0,
          shadow: null,
          text: spec.text,
          fill: { type: 'solid', color: spec.fill ?? '#171717' },
          stroke: AI_DEFAULT_STROKE,
          strokeWidth: 0,
          fontFamily: spec.fontFamily ?? 'Inter',
          fontSize,
          letterSpacing: clampTextLetterSpacing(spec.letterSpacing ?? 0),
          lineHeight: 1.22,
          fontWeight: spec.fontWeight ?? 'normal',
          fontStyle: spec.fontStyle ?? 'normal',
          underline: false,
          textAlign: spec.textAlign ?? 'left',
        }
        obj.height = Math.max(layoutSceneText(obj).height, obj.fontSize * sceneTextLineHeight(obj))
        addObjects([obj])
        return { id: obj.id }
      },
      addLine: spec => {
        const width = Math.max(1, Math.hypot(spec.x2 - spec.x1, spec.y2 - spec.y1))
        const height = Math.max(24, (spec.strokeWidth ?? 4) * 3)
        const centerX = (spec.x1 + spec.x2) / 2
        const centerY = (spec.y1 + spec.y2) / 2
        const obj: SceneLine = {
          id: crypto.randomUUID(),
          type: 'line',
          x: centerX - width / 2,
          y: centerY - height / 2,
          width,
          height,
          rotation: angleFromPoints(spec.x1, spec.y1, spec.x2, spec.y2),
          opacity: spec.opacity ?? 1,
          visible: true,
          locked: false,
          blurPct: 0,
          shadow: null,
          stroke: { type: 'solid', color: spec.stroke ?? '#262626' },
          strokeWidth: spec.strokeWidth ?? 4,
          lineStyle: 'solid',
          roundedEnds: true,
        }
        addObjects([obj])
        return { id: obj.id }
      },
      addImageFromUrl: async spec => {
        const id = await placeImageObject(spec.url, {
          x: spec.x,
          y: spec.y,
          origin: spec.origin,
          width: spec.width,
          height: spec.height,
        })
        return id ? { id } : null
      },
      updateObject: (id, patch) => {
        if (!doc.objects.some(obj => obj.id === id)) return false
        setDoc(prev => ({
          ...prev,
          objects: prev.objects.map(obj => (obj.id === id ? applyAiPatch(obj, patch) : obj)),
        }))
        return true
      },
      deleteObject: id => {
        const exists = doc.objects.some(obj => obj.id === id)
        if (!exists) return false
        setDoc(prev => ({
          ...prev,
          objects: prev.objects.filter(obj => obj.id !== id),
        }))
        return true
      },
      selectObjects: ids => {
        const valid = ids.filter(id => doc.objects.some(obj => obj.id === id))
        setSelectedIds(valid)
        return valid.length
      },
      setBackground: paint => setDoc(prev => ({ ...prev, bg: parseAiPaint(paint) })),
      exportImage: async ({ format, scale, transparent, fileName }) => {
        const { width, height } = doc.artboard
        const url = await renderAvnacDocumentToDataUrl(doc, vectorBoardDocs, {
          format,
          multiplier: scale,
          transparent,
        })
        const base = (fileName ?? 'duet-design')
          .replace(/[^a-z0-9_-]+/gi, '-')
          .replace(/^-+|-+$/g, '')
        const name = `${base || 'duet-design'}.${format}`
        // A download is the only honest way to return an image here: a
        // 1080x1350 PNG as base64 is megabytes, and putting that in a tool
        // result would flood the agent's context to no purpose.
        const a = document.createElement('a')
        a.href = url
        a.download = name
        a.click()
        return {
          fileName: name,
          width: Math.round(width * scale),
          height: Math.round(height * scale),
        }
      },
      clearCanvas: () => {
        const count = doc.objects.length
        setDoc(prev => ({ ...prev, objects: [] }))
        setSelectedIds([])
        return count
      },

      getSelection: () => [...selectedIds],

      loadDocument: next => {
        // Templates arrive as hand-authored JSON that may omit `pages` or
        // other derived fields, so normalise through the same validator the
        // file-import path uses. Returns null for anything unusable, which the
        // tool layer surfaces as text rather than an exception.
        const parsed = parseAvnacDocument(next)
        if (!parsed) return null
        setDoc(prev => ({
          ...prev,
          artboard: { ...parsed.artboard },
          bg: parsed.bg,
          objects: remeasureTextObjects(parsed.objects),
        }))
        setSelectedIds([])
        return parsed.objects.length
      },

      resizeArtboard: (width, height, strategy) => {
        const from = { width: doc.artboard.width, height: doc.artboard.height }
        const to = { width: Math.round(width), height: Math.round(height) }
        setDoc(prev => ({
          ...prev,
          artboard: { ...to },
          objects: reflowObjectsForArtboard(prev.objects, from, to, strategy),
        }))
        return to
      },

      updateMany: (ids, patch) => {
        const wanted = new Set(ids)
        const matched = doc.objects.filter(obj => wanted.has(obj.id)).length
        if (matched === 0) return 0
        setDoc(prev => ({
          ...prev,
          objects: prev.objects.map(obj => (wanted.has(obj.id) ? applyAiPatch(obj, patch) : obj)),
        }))
        return matched
      },

      updateEach: updates => {
        const byId = new Map(updates.map(u => [u.id, u.patch]))
        let changed = 0
        setDoc(prev => {
          let n = 0
          const objects = prev.objects.map(obj => {
            const patch = byId.get(obj.id)
            if (!patch) return obj
            n += 1
            return applyAiPatch(obj, patch)
          })
          // Assigned rather than incremented, so a double-invoked updater
          // cannot inflate the count.
          changed = n
          return { ...prev, objects }
        })
        return changed
      },

      deleteMany: ids => {
        const wanted = new Set(ids)
        let removed = 0
        setDoc(prev => {
          const objects = prev.objects.filter(obj => !wanted.has(obj.id))
          removed = prev.objects.length - objects.length
          return { ...prev, objects }
        })
        setSelectedIds(prev => prev.filter(id => !wanted.has(id)))
        return removed
      },

      setObjectRole: (id, role) => {
        // Checked inside the updater rather than against the captured `doc`:
        // an object added moments ago is not in `doc` yet, so an outer guard
        // would silently drop the role.
        let found = false
        setDoc(prev => {
          if (!prev.objects.some(obj => obj.id === id)) return prev
          found = true
          return {
            ...prev,
            objects: prev.objects.map(obj =>
              obj.id === id ? { ...obj, role: role?.trim() || undefined } : obj,
            ),
          }
        })
        return found
      },
    }),
    [
      addObjects,
      artboardH,
      artboardW,
      doc,
      placeImageObject,
      selectedIds,
      setDoc,
      setSelectedIds,
      vectorBoardDocs,
    ],
  )
}
