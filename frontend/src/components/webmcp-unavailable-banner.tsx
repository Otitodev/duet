import { useEffect, useState } from 'react'

import { isWebMcpAvailable } from '../lib/avnac-webmcp'

const FLAG_URL = 'chrome://flags/#enable-webmcp-testing'

/**
 * Shown only when the browser exposes no WebMCP registry.
 *
 * Without this, someone opening Duet in ordinary Chrome sees a plain design
 * editor, nothing agent-related happens, and they reasonably conclude the
 * WebMCP work is absent. Floats over the canvas so it never shifts layout.
 */
export default function WebMcpUnavailableBanner() {
  const [available, setAvailable] = useState(true)
  const [copied, setCopied] = useState(false)

  // Checked after mount so server-render and first paint agree.
  useEffect(() => {
    setAvailable(isWebMcpAvailable())
  }, [])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(t)
  }, [copied])

  if (available) return null

  return (
    <div
      data-avnac-chrome
      role="status"
      className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-40 flex justify-center px-4"
    >
      <div className="pointer-events-auto flex max-w-[46rem] flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border border-amber-500/25 bg-amber-50/95 px-4 py-2.5 text-[13px] leading-5 text-amber-950 shadow-[0_10px_30px_rgba(120,80,0,0.10)] backdrop-blur-md">
        <span className="font-semibold">WebMCP not detected.</span>
        <span className="text-amber-900/80">
          Open this page in ChatGPT's browser, or enable this flag in Chrome 146+:
        </span>
        <code className="rounded-md bg-amber-900/[0.08] px-1.5 py-0.5 font-mono text-[12px]">
          {FLAG_URL}
        </code>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(FLAG_URL).then(
              () => setCopied(true),
              () => setCopied(false),
            )
          }}
          className="ml-auto cursor-pointer rounded-full border border-amber-900/20 bg-white/70 px-3 py-1 font-semibold text-amber-950 transition hover:bg-white"
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
