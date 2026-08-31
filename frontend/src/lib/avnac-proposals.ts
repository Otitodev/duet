/**
 * Pending change proposals: the agent suggests, the person decides.
 *
 * Three worlds need this same state and none of them can own it:
 *   - the tool layer (plain functions, no React)
 *   - the canvas, to draw ghost previews
 *   - the review panel, to offer approve and reject
 *
 * So it lives here as a module singleton with subscribe/getSnapshot, read from
 * React through useSyncExternalStore and called directly from tools. Same shape
 * as Avnac's own editor store, minus React ownership.
 */

import type { AiUpdateSpec } from './avnac-ai-controller'

export type ProposalChange = {
  /** Real object id. */
  id: string
  /** Readable id, for talking to the agent. */
  alias: string
  patch: AiUpdateSpec
  /** One line describing the change in words. */
  summary: string
  /** The person's toggle. Starts included; unchecking it means reject. */
  included: boolean
  /** Set when the target object no longer exists by the time of the decision. */
  gone?: boolean
}

export type ProposalStatus = 'pending' | 'approved' | 'rejected' | 'partial' | 'expired'

export type Proposal = {
  id: string
  rationale: string
  changes: ProposalChange[]
  status: ProposalStatus
  note: string | null
  createdAt: number
}

/** How long an untouched proposal stays on screen before it is collected. */
const EXPIRY_MS = 10 * 60 * 1000

type Waiter = () => void

let current: Proposal | null = null
let sequence = 0
let expiryTimer: ReturnType<typeof setTimeout> | null = null
const waiters = new Set<Waiter>()
const subscribers = new Set<() => void>()
let onArrive: ((proposal: Proposal) => void) | null = null

function emit() {
  for (const fn of subscribers) fn()
}

/** Wake every pending check_proposal call. */
function releaseWaiters() {
  const pending = [...waiters]
  waiters.clear()
  for (const w of pending) w()
}

function clearExpiry() {
  if (expiryTimer !== null) {
    clearTimeout(expiryTimer)
    expiryTimer = null
  }
}

// --- React side -------------------------------------------------------------

export function subscribe(fn: () => void): () => void {
  subscribers.add(fn)
  return () => {
    subscribers.delete(fn)
  }
}

/** Stable snapshot for useSyncExternalStore. */
export function getSnapshot(): Proposal | null {
  return current
}

/** Called by the editor so an arriving proposal can open its panel. */
export function setArrivalHandler(fn: ((proposal: Proposal) => void) | null): void {
  onArrive = fn
}

// --- Tool side --------------------------------------------------------------

export function openProposal(input: {
  rationale: string
  changes: Array<Omit<ProposalChange, 'included'>>
}): Proposal {
  sequence += 1
  const proposal: Proposal = {
    id: `p_${sequence}`,
    rationale: input.rationale,
    changes: input.changes.map(c => ({ ...c, included: true })),
    status: 'pending',
    note: null,
    createdAt: Date.now(),
  }
  current = proposal
  clearExpiry()
  expiryTimer = setTimeout(() => {
    if (current?.id === proposal.id && current.status === 'pending') {
      current = { ...current, status: 'expired' }
      emit()
      releaseWaiters()
    }
  }, EXPIRY_MS)
  emit()
  onArrive?.(proposal)
  return proposal
}

export function getProposal(id: string): Proposal | null {
  return current?.id === id ? current : null
}

export function hasOpenProposal(): boolean {
  return current !== null && current.status === 'pending'
}

/**
 * Wait for a decision, or give up after `timeoutMs` and report it as still
 * pending.
 *
 * Deliberately setTimeout and not requestAnimationFrame: rAF does not fire in
 * a background tab, and an agent-driven page is backgrounded constantly. A
 * twenty-second rAF wait would simply never return.
 */
export function awaitDecision(id: string, timeoutMs: number): Promise<Proposal | null> {
  const proposal = getProposal(id)
  if (!proposal) return Promise.resolve(null)
  if (proposal.status !== 'pending') return Promise.resolve(proposal)

  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      waiters.delete(finish)
      clearTimeout(timer)
      resolve(getProposal(id) ?? current)
    }
    const timer = setTimeout(finish, timeoutMs)
    waiters.add(finish)
  })
}

// --- Decisions --------------------------------------------------------------

export function toggleChange(changeId: string, included: boolean): void {
  if (!current || current.status !== 'pending') return
  current = {
    ...current,
    changes: current.changes.map(c => (c.id === changeId ? { ...c, included } : c)),
  }
  emit()
}

export function setAllIncluded(included: boolean): void {
  if (!current || current.status !== 'pending') return
  current = { ...current, changes: current.changes.map(c => ({ ...c, included })) }
  emit()
}

export function setNote(note: string): void {
  if (!current || current.status !== 'pending') return
  current = { ...current, note: note.trim() ? note : null }
  emit()
}

/**
 * Record the outcome. The caller applies the approved patches first, and
 * reports which ids no longer existed so the agent hears about them.
 */
export function settleProposal(missingIds: string[] = []): Proposal | null {
  if (!current || current.status !== 'pending') return current
  const missing = new Set(missingIds)
  const changes = current.changes.map(c => (missing.has(c.id) ? { ...c, gone: true } : c))
  const applied = changes.filter(c => c.included && !c.gone).length
  const refused = changes.filter(c => !c.included).length

  let status: ProposalStatus = 'partial'
  if (refused === 0 && applied === changes.length) status = 'approved'
  else if (applied === 0) status = 'rejected'

  current = { ...current, changes, status }
  clearExpiry()
  emit()
  releaseWaiters()
  return current
}

/** Clear the review surface once the person has seen the outcome. */
export function dismissProposal(): void {
  clearExpiry()
  current = null
  emit()
  releaseWaiters()
}

/** Tear down timers and waiters when the editor unmounts. */
export function resetProposals(): void {
  clearExpiry()
  current = null
  onArrive = null
  releaseWaiters()
  emit()
}
