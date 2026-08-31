import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useState, useSyncExternalStore } from 'react'

import {
  dismissProposal,
  getSnapshot,
  type Proposal,
  setAllIncluded,
  setNote,
  settleProposal,
  subscribe,
  toggleChange,
} from '../lib/avnac-proposals'
import {
  editorSidebarPanelLeftClass,
  editorSidebarPanelTopClass,
} from '../lib/editor-sidebar-panel-layout'
import { useAiController } from './scene-editor/ai-controller-context'

type Props = {
  open: boolean
  onClose: () => void
}

const OUTCOME_COPY: Record<string, string> = {
  approved: 'You approved every change.',
  rejected: 'You rejected every change.',
  partial: 'You approved some of the changes.',
  expired: 'This proposal expired before it was reviewed.',
}

function ReviewCard({ proposal }: { proposal: Proposal }) {
  const controller = useAiController()
  const [note, setLocalNote] = useState('')

  const decide = (includeAll: boolean | null) => {
    if (includeAll !== null) setAllIncluded(includeAll)
    if (note.trim()) setNote(note)

    // Read the live scene so a change whose target was deleted while the
    // person deliberated is reported rather than silently applied.
    const live = controller.getCanvas()
    const alive = new Set((live?.objects ?? []).map(o => o.id))
    const current = getSnapshot()
    if (!current) return

    const wanted = includeAll === false ? [] : current.changes.filter(c => c.included)
    const missing = current.changes.filter(c => !alive.has(c.id)).map(c => c.id)
    const applicable = wanted.filter(c => alive.has(c.id))

    if (applicable.length > 0) {
      // One commit, so the whole batch lands together and a single undo
      // restores all of it.
      controller.updateEach(applicable.map(c => ({ id: c.id, patch: c.patch })))
    }
    settleProposal(missing)
  }

  const settled = proposal.status !== 'pending'
  const includedCount = proposal.changes.filter(c => c.included).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-black/[0.06] px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
          {settled ? 'Reviewed' : 'The agent is proposing a change'}
        </div>
        <p className="mt-1 text-[13px] leading-5 text-neutral-700">
          {settled ? OUTCOME_COPY[proposal.status] : proposal.rationale}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {proposal.changes.map(change => (
          <label
            key={change.id}
            className={[
              'flex cursor-pointer items-start gap-2.5 rounded-xl px-2 py-2 text-[13px] leading-5',
              settled ? 'cursor-default' : 'hover:bg-black/[0.04]',
              change.included ? 'text-neutral-800' : 'text-neutral-400 line-through',
            ].join(' ')}
          >
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-violet-600"
              checked={change.included}
              disabled={settled}
              onChange={e => toggleChange(change.id, e.target.checked)}
            />
            <span>
              <span className="font-mono text-[12px] text-neutral-500">{change.alias}</span>{' '}
              {change.summary}
              {change.gone ? (
                <span className="ml-1 text-[12px] text-amber-700">(no longer exists)</span>
              ) : null}
            </span>
          </label>
        ))}
      </div>

      {settled ? (
        <div className="border-t border-black/[0.06] p-3">
          <button
            type="button"
            className="w-full cursor-pointer rounded-full bg-neutral-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-neutral-700"
            onClick={() => dismissProposal()}
          >
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-2 border-t border-black/[0.06] p-3">
          <input
            type="text"
            value={note}
            onChange={e => setLocalNote(e.target.value)}
            placeholder="Add a note back to the agent (optional)"
            className="w-full rounded-xl border border-black/[0.1] px-3 py-2 text-[13px] outline-none placeholder:text-neutral-400 focus:border-violet-400"
          />
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 cursor-pointer rounded-full bg-violet-600 px-4 py-2 text-[13px] font-semibold text-white hover:bg-violet-500 disabled:opacity-40"
              disabled={includedCount === 0}
              onClick={() => decide(null)}
            >
              Apply {includedCount} of {proposal.changes.length}
            </button>
            <button
              type="button"
              className="cursor-pointer rounded-full border border-black/[0.12] px-4 py-2 text-[13px] font-semibold text-neutral-800 hover:bg-black/[0.04]"
              onClick={() => decide(false)}
            >
              Reject all
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The Duet panel: where the agent's work becomes reviewable.
 *
 * Currently holds the proposal review card. The tool-call activity log lands
 * here too, so this is deliberately a container rather than a proposal-only
 * component.
 */
export default function EditorDuetPanel({ open, onClose }: Props) {
  const proposal = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  if (!open) return null

  return (
    <div
      data-avnac-chrome
      className={[
        'pointer-events-auto fixed z-40 flex max-h-[min(80dvh,620px)] w-[min(100vw-1.5rem,340px)] flex-col overflow-hidden rounded-3xl border border-black/[0.08] bg-white/95 backdrop-blur-md',
        editorSidebarPanelLeftClass,
        editorSidebarPanelTopClass,
      ].join(' ')}
      role="dialog"
      aria-label="Duet"
    >
      <div className="flex items-center justify-between border-b border-black/[0.06] px-3 py-2">
        <span className="text-sm font-semibold text-neutral-800">Duet</span>
        <button
          type="button"
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-neutral-600 hover:bg-black/[0.06]"
          onClick={onClose}
          aria-label="Close Duet panel"
        >
          <HugeiconsIcon icon={Cancel01Icon} size={18} strokeWidth={1.75} />
        </button>
      </div>

      {proposal ? (
        <ReviewCard proposal={proposal} />
      ) : (
        <div className="px-4 py-8 text-center text-[13px] leading-5 text-neutral-500">
          When an agent proposes a change, it appears here for you to approve or reject before
          anything is applied.
        </div>
      )}
    </div>
  )
}
