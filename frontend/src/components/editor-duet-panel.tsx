import { Cancel01Icon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { TRY_ASKING } from '../data/prompts'
import {
  type ActivityEntry,
  getSnapshot as getActivity,
  getDroppedCount,
  subscribe as subscribeActivity,
} from '../lib/avnac-activity'
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
      // One commit, so the whole batch lands together.
      controller.updateEach(applicable.map(c => ({ id: c.id, patch: c.patch })))
    }
    settleProposal(missing)
  }

  const settled = proposal.status !== 'pending'
  const includedCount = proposal.changes.filter(c => c.included).length

  return (
    <div className="border-b border-black/[0.08] bg-violet-50/60">
      <div className="px-3 py-2.5">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-700">
          {settled ? 'Reviewed' : 'The agent is proposing a change'}
        </div>
        <p className="mt-1 text-[13px] leading-5 text-neutral-700">
          {settled ? OUTCOME_COPY[proposal.status] : proposal.rationale}
        </p>
      </div>

      <div className="max-h-[220px] overflow-y-auto px-3 pb-1">
        {proposal.changes.map(change => (
          <label
            key={change.id}
            className={[
              'flex items-start gap-2.5 rounded-xl px-2 py-1.5 text-[13px] leading-5',
              settled ? 'cursor-default' : 'cursor-pointer hover:bg-black/[0.04]',
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
        <div className="p-3">
          <button
            type="button"
            className="w-full cursor-pointer rounded-full bg-neutral-900 px-4 py-2 text-[13px] font-semibold text-white hover:bg-neutral-700"
            onClick={() => dismissProposal()}
          >
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-2 p-3">
          <input
            type="text"
            value={note}
            onChange={e => setLocalNote(e.target.value)}
            placeholder="Add a note back to the agent (optional)"
            className="w-full rounded-xl border border-black/[0.1] bg-white px-3 py-2 text-[13px] outline-none placeholder:text-neutral-400 focus:border-violet-400"
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
              className="cursor-pointer rounded-full border border-black/[0.12] bg-white px-4 py-2 text-[13px] font-semibold text-neutral-800 hover:bg-black/[0.04]"
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

function formatArgs(args: Record<string, unknown>): string {
  const keys = Object.keys(args)
  if (keys.length === 0) return '{ }'
  const body = keys
    .map(k => {
      const v = args[k]
      const text = typeof v === 'string' ? `"${v}"` : JSON.stringify(v)
      return `${k}: ${text && text.length > 48 ? `${text.slice(0, 45)}…` : text}`
    })
    .join(', ')
  return `{ ${body} }`
}

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const time = new Date(entry.at).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
  return (
    <li className="border-b border-black/[0.05] px-3 py-2 last:border-b-0">
      <div className="flex items-baseline gap-2">
        <span
          className={[
            'font-mono text-[12px] font-semibold',
            entry.ok ? 'text-violet-700' : 'text-amber-700',
          ].join(' ')}
        >
          {entry.tool}
        </span>
        <span className="ml-auto shrink-0 font-mono text-[11px] text-neutral-400">
          {entry.ms}ms · {time}
        </span>
      </div>
      {/* The arguments are the point. A list of names reads as a progress
          spinner; the arguments read as a machine doing specific work. */}
      <div className="mt-0.5 break-words font-mono text-[11px] leading-4 text-neutral-500">
        {formatArgs(entry.args)}
      </div>
      <div className="mt-1 break-words text-[12px] leading-4 text-neutral-600">{entry.preview}</div>
    </li>
  )
}

function TryAsking() {
  const [copied, setCopied] = useState<string | null>(null)
  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(null), 1600)
    return () => window.clearTimeout(t)
  }, [copied])

  return (
    <div className="px-3 py-3">
      <p className="text-[13px] leading-5 text-neutral-600">
        This canvas is wired for AI agents. Open it in an agent that speaks WebMCP and try asking:
      </p>
      <ul className="mt-2.5 space-y-1.5">
        {TRY_ASKING.map(prompt => (
          <li key={prompt}>
            <button
              type="button"
              className="w-full cursor-pointer rounded-xl border border-black/[0.08] bg-white px-3 py-2 text-left text-[13px] leading-5 text-neutral-800 transition hover:border-violet-300 hover:bg-violet-50"
              onClick={() => {
                void navigator.clipboard?.writeText(prompt).then(
                  () => setCopied(prompt),
                  () => setCopied(null),
                )
              }}
            >
              <span>{copied === prompt ? 'Copied' : prompt}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-[12px] leading-4 text-neutral-400">
        Every tool the agent calls is listed here, with its arguments.
      </p>
    </div>
  )
}

/**
 * The Duet panel: where the agent's work becomes reviewable.
 *
 * Holds the proposal review card and the tool-call activity log. The log is the
 * evidence that any of this is real -- a flyer appearing proves nothing on its
 * own, since a canned animation looks the same.
 */
export default function EditorDuetPanel({ open, onClose }: Props) {
  const proposal = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const activity = useSyncExternalStore(subscribeActivity, getActivity, getActivity)
  if (!open) return null

  const dropped = getDroppedCount()

  return (
    <div
      data-avnac-chrome
      className={[
        'pointer-events-auto fixed z-40 flex max-h-[min(82dvh,660px)] w-[min(100vw-1.5rem,340px)] flex-col overflow-hidden rounded-3xl border border-black/[0.08] bg-white/95 backdrop-blur-md',
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

      {proposal ? <ReviewCard proposal={proposal} /> : null}

      {activity.length === 0 ? (
        proposal ? null : (
          <TryAsking />
        )
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex items-baseline justify-between px-3 pb-1 pt-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">
              Tool calls
            </span>
            <span className="font-mono text-[11px] text-neutral-400">
              {activity.length}
              {dropped > 0 ? ` (+${dropped} older)` : ''}
            </span>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto" aria-label="Tool call history">
            {activity.map(entry => (
              <ActivityRow key={entry.id} entry={entry} />
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
