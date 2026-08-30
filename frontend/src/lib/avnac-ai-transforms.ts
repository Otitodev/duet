/**
 * Pure scene transforms shared by the agent-facing controller.
 *
 * These are deliberately free of React and of the editor store so they can be
 * reasoned about (and tested) on their own. The controller in
 * `components/scene-editor/use-ai-design-controller.ts` wires them to `setDoc`.
 */

import type { AiReflowStrategy, AiUpdateSpec } from './avnac-ai-controller'
import {
  clampTextLetterSpacing,
  type SceneObject,
  setObjectFill,
  setObjectStroke,
  setObjectStrokeWidth,
} from './avnac-scene'
import { layoutSceneText, sceneTextLineHeight } from './avnac-scene-render'

/** Recompute a text object's height after its text, size, or spacing changed. */
function withMeasuredTextHeight(obj: SceneObject): SceneObject {
  if (obj.type !== 'text') return obj
  return {
    ...obj,
    height: Math.max(layoutSceneText(obj).height, obj.fontSize * sceneTextLineHeight(obj)),
  }
}

/**
 * Apply one patch to one object. Shared by `updateObject` and `updateMany` so
 * a single object and a batch can never drift apart in behaviour.
 */
export function applyAiPatch(obj: SceneObject, patch: AiUpdateSpec): SceneObject {
  let next: SceneObject = { ...obj }
  if (patch.left !== undefined) next.x = patch.left
  if (patch.top !== undefined) next.y = patch.top
  if (patch.width !== undefined) next.width = patch.width
  if (patch.height !== undefined) next.height = patch.height
  if (patch.angle !== undefined) next.rotation = patch.angle
  if (patch.opacity !== undefined) next.opacity = Math.max(0, Math.min(1, patch.opacity))
  if (patch.fill !== undefined) next = setObjectFill(next, { type: 'solid', color: patch.fill })
  if (patch.stroke !== undefined) {
    next = setObjectStroke(next, { type: 'solid', color: patch.stroke })
  }
  if (patch.strokeWidth !== undefined) next = setObjectStrokeWidth(next, patch.strokeWidth)
  if (patch.role !== undefined) next.role = patch.role || undefined
  if (next.type === 'text') {
    if (patch.text !== undefined) next.text = patch.text
    if (patch.fontSize !== undefined) next.fontSize = Math.max(1, patch.fontSize)
    if (patch.letterSpacing !== undefined) {
      next.letterSpacing = clampTextLetterSpacing(patch.letterSpacing)
    }
    next = withMeasuredTextHeight(next)
  }
  return next
}

function scaleObject(obj: SceneObject, kx: number, ky: number): SceneObject {
  const next: SceneObject = {
    ...obj,
    x: obj.x * kx,
    y: obj.y * ky,
    width: Math.max(1, obj.width * kx),
    height: Math.max(1, obj.height * ky),
  }
  if (next.type === 'text') {
    // Type scales uniformly, otherwise a non-square resize distorts it. The
    // smaller factor is used so text never overflows the new artboard.
    next.fontSize = Math.max(1, next.fontSize * Math.min(kx, ky))
    return withMeasuredTextHeight(next)
  }
  return next
}

function translateObject(obj: SceneObject, dx: number, dy: number): SceneObject {
  return { ...obj, x: obj.x + dx, y: obj.y + dy }
}

function boundingBox(objects: SceneObject[]) {
  const left = Math.min(...objects.map(o => o.x))
  const top = Math.min(...objects.map(o => o.y))
  const right = Math.max(...objects.map(o => o.x + o.width))
  const bottom = Math.max(...objects.map(o => o.y + o.height))
  return { left, top, right, bottom, width: right - left, height: bottom - top }
}

/**
 * Reflow objects for a new artboard size.
 *
 * Avnac's own `onArtboardResize` changes the artboard and leaves objects
 * untouched, so there is no upstream behaviour to match here.
 *
 * - `scale`           stretch everything to the new proportions
 * - `fit`             scale uniformly by the smaller ratio, then centre
 * - `keep_positions`  change the frame only
 */
export function reflowObjectsForArtboard(
  objects: SceneObject[],
  from: { width: number; height: number },
  to: { width: number; height: number },
  strategy: AiReflowStrategy,
): SceneObject[] {
  if (strategy === 'keep_positions') return objects
  if (objects.length === 0) return objects
  if (from.width <= 0 || from.height <= 0) return objects

  const kx = to.width / from.width
  const ky = to.height / from.height

  if (strategy === 'scale') return objects.map(obj => scaleObject(obj, kx, ky))

  const k = Math.min(kx, ky)
  const scaled = objects.map(obj => scaleObject(obj, k, k))
  const box = boundingBox(scaled)
  const dx = (to.width - box.width) / 2 - box.left
  const dy = (to.height - box.height) / 2 - box.top
  return scaled.map(obj => translateObject(obj, dx, dy))
}
