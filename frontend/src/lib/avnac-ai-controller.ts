/**
 * Stable runtime surface that the Tambo agent uses to manipulate the main
 * design scene. Built inside `SceneEditor` where it can close over the
 * editor state; consumers receive it as a React ref (null until editor is
 * mounted) so they can defensively no-op when missing.
 */

/** How existing objects respond when the artboard is resized. */
export type AiReflowStrategy = 'scale' | 'fit' | 'keep_positions'

export type AiObjectKind =
  | 'rect'
  | 'ellipse'
  | 'text'
  | 'line'
  | 'image'
  | 'icon'
  | 'polygon'
  | 'star'
  | 'arrow'
  | 'group'
  | 'vector-board'
  | 'other'

export type AiObjectSummary = {
  id: string
  kind: AiObjectKind
  label: string
  /** Semantic template slot, e.g. 'headline' or 'accent'. Null when unset. */
  role: string | null
  left: number
  top: number
  width: number
  height: number
  angle: number
  fill: string | null
  stroke: string | null
  text: string | null
  /** Current size for text objects, null otherwise. Needed for "make it bigger". */
  fontSize: number | null
  opacity: number
  /** Hidden objects are skipped by layout analysis -- nobody can see them. */
  visible: boolean
  /** Outline thickness. A stroke colour with width 0 renders nothing. */
  strokeWidth: number
  /** Rounded corners. Rectangles and images only, 0 elsewhere. */
  cornerRadius: number
  /** Text objects only. */
  fontFamily: string | null
  /** Text objects only. */
  fontWeight: number | 'normal' | 'bold' | null
  /** Text objects only. */
  textAlign: string | null
  /** Whether a drop shadow is set. */
  hasShadow: boolean
}

export type AiCanvasInfo = {
  width: number
  height: number
  background: string | null
  objectCount: number
  objects: AiObjectSummary[]
}

export type AiPlacement = {
  x?: number
  y?: number
  origin?: 'center' | 'top-left'
}

export type AiRectSpec = AiPlacement & {
  width: number
  height: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  cornerRadius?: number
  rotation?: number
  opacity?: number
}

export type AiEllipseSpec = AiPlacement & {
  width: number
  height: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  rotation?: number
  opacity?: number
}

export type AiTextSpec = AiPlacement & {
  text: string
  fontSize?: number
  letterSpacing?: number
  fontFamily?: string
  fontWeight?: number | 'normal' | 'bold'
  fontStyle?: 'normal' | 'italic'
  fill?: string
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  width?: number
  rotation?: number
  opacity?: number
}

export type AiLineSpec = {
  x1: number
  y1: number
  x2: number
  y2: number
  stroke?: string
  strokeWidth?: number
  opacity?: number
}

export type AiImageSpec = AiPlacement & {
  /** HTTPS/HTTP image URL or `data:image/*;base64,...` */
  url: string
  width?: number
  height?: number
  rotation?: number
  opacity?: number
}

export type AiUpdateSpec = {
  left?: number
  top?: number
  width?: number
  height?: number
  scaleX?: number
  scaleY?: number
  angle?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  opacity?: number
  text?: string
  fontSize?: number
  letterSpacing?: number
  /** Semantic template slot. Empty string clears it. */
  role?: string

  /** Rounded corners, in canvas pixels. Rectangles and images only. */
  cornerRadius?: number
  /** Backdrop blur, 0-100. */
  blurPct?: number
  /** Text only. Must be a Google font family the editor knows. */
  fontFamily?: string
  /** Text only. 100-900, or 'normal' / 'bold'. */
  fontWeight?: number | 'normal' | 'bold'
  /** Text only. */
  fontStyle?: 'normal' | 'italic'
  /** Text only. */
  textAlign?: 'left' | 'center' | 'right' | 'justify'
  /** Drop shadow, or null to remove it. */
  shadow?: AiShadowSpec | null
}

/** A drop shadow as the tools express it. */
export type AiShadowSpec = {
  blur?: number
  offsetX?: number
  offsetY?: number
  /** Six-digit hex. */
  color?: string
  /** 0-100. */
  opacity?: number
}

export type AiDesignController = {
  getCanvas: () => AiCanvasInfo | null
  addRectangle: (spec: AiRectSpec) => { id: string } | null
  addEllipse: (spec: AiEllipseSpec) => { id: string } | null
  addText: (spec: AiTextSpec) => { id: string } | null
  addLine: (spec: AiLineSpec) => { id: string } | null
  addImageFromUrl: (spec: AiImageSpec) => Promise<{ id: string } | null>
  updateObject: (id: string, patch: AiUpdateSpec) => boolean
  deleteObject: (id: string) => boolean
  selectObjects: (ids: string[]) => number
  /** Canvas background. Accepts a CSS colour or a CSS linear-gradient. */
  setBackground: (paint: string) => void
  /**
   * Render the active page and hand the file to the person as a download.
   * Returns what was written, or null if the canvas is not ready.
   */
  exportImage: (opts: {
    format: 'png' | 'jpg' | 'webp'
    scale: number
    transparent: boolean
    fileName?: string
  }) => Promise<{ fileName: string; width: number; height: number } | null>
  clearCanvas: () => number

  /** Ids the human currently has selected, in selection order. */
  getSelection: () => string[]
  /**
   * Replace artboard, background and objects in one commit. Accepts loosely
   * shaped template JSON and normalises it. Returns the object count, or null
   * if the payload is not a usable document.
   */
  loadDocument: (doc: unknown) => number | null
  /** Resize the artboard and reflow its contents. Returns the applied size. */
  resizeArtboard: (
    width: number,
    height: number,
    strategy: AiReflowStrategy,
  ) => { width: number; height: number }
  /** Apply one patch across many objects. Returns how many actually matched. */
  updateMany: (ids: string[], patch: AiUpdateSpec) => number
  /** Tag an object with a semantic slot. Pass null to clear. */
  setObjectRole: (id: string, role: string | null) => boolean
  /**
   * Apply a *different* patch to each of many objects, in a single commit.
   * updateMany applies one shared patch; alignment needs a distinct x per
   * object, and looping updateObject would re-render once per object.
   */
  updateEach: (updates: Array<{ id: string; patch: AiUpdateSpec }>) => number
  /** Remove many objects in one commit. Returns how many actually existed. */
  deleteMany: (ids: string[]) => number
}
