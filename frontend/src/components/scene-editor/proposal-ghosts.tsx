import { useSyncExternalStore } from 'react'

import { applyAiPatch } from '../../lib/avnac-ai-transforms'
import { getSnapshot, subscribe } from '../../lib/avnac-proposals'
import type { SceneObject } from '../../lib/avnac-scene'
import type { VectorBoardDocument } from '../../lib/avnac-vector-board-document'
import { SceneObjectView } from './object-view'

const noop = () => {}

/**
 * Ghost previews of a pending proposal, drawn over the real canvas.
 *
 * Mounted as a sibling of the object layer and inside the same artboard
 * wrapper, so ghosts inherit the artboard transform and land exactly over the
 * objects they preview.
 *
 * Ghosts are recomputed from the *live* objects on every render rather than
 * from a snapshot taken when the proposal arrived. The person may drag things
 * while they decide, and the agent may edit through other tools; a live-derived
 * ghost stays truthful, where a snapshot would preview a document that no
 * longer exists.
 */
export function ProposalGhosts({
  objects,
  vectorBoardDocs,
}: {
  objects: SceneObject[]
  vectorBoardDocs: Record<string, VectorBoardDocument>
}) {
  const proposal = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!proposal || proposal.status !== 'pending') return null

  const byId = new Map(objects.map(o => [o.id, o]))
  const ghosts = proposal.changes
    .filter(change => change.included)
    .map(change => {
      const live = byId.get(change.id)
      // A change whose target has since been deleted simply has nothing to
      // preview. It is reported as no longer applicable on decision.
      return live ? applyAiPatch(live, change.patch) : null
    })
    .filter((o): o is SceneObject => o !== null && o.visible)

  if (ghosts.length === 0) return null

  return (
    <div
      // pointer-events-none matters: a ghost must never intercept a click
      // meant for the real object underneath it.
      className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]"
      aria-hidden
    >
      <div className="absolute inset-0 opacity-70">
        {ghosts.map(obj => (
          <SceneObjectView
            key={`ghost-${obj.id}`}
            obj={obj}
            vectorBoardDocs={vectorBoardDocs}
            textEditingId={null}
            textDraft=""
            onObjectPointerDown={noop}
            onObjectHoverChange={noop}
            onTextDoubleClick={noop}
            onTextDraftChange={noop}
            onTextDraftCommit={noop}
          />
        ))}
      </div>
      {ghosts.map(obj => (
        <div
          key={`ghost-outline-${obj.id}`}
          className="absolute rounded-[2px] border-2 border-dashed border-[#7c3aed]"
          style={{
            left: obj.x,
            top: obj.y,
            width: Math.max(1, obj.width),
            height: Math.max(1, obj.height),
            transform: obj.rotation ? `rotate(${obj.rotation}deg)` : undefined,
          }}
        />
      ))}
    </div>
  )
}
