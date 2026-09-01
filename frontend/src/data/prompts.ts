/**
 * The prompts shown to someone who does not yet know what to ask.
 *
 * Shared deliberately: the landing page and the editor panel must show the
 * identical set, and the demo video must speak the identical words. A judge who
 * hears one sentence and is then offered a different one is being told two
 * stories, which is worse than telling neither.
 *
 * Lives here rather than in the panel so the landing page can use it without
 * pulling the panel, the proposal store and the activity store into its bundle.
 */
export const TRY_ASKING = [
  'Design a poster for a tech conference called WebMCP Summit 2026',
  'Make these two bigger and line them up',
  'Make the background a deep teal to amber gradient',
  'Now give me a TikTok version and export it',
] as const
