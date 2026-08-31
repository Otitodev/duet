/**
 * The prompts shown to someone who does not yet know what to ask.
 *
 * Shared deliberately: the landing page and the editor panel must show the
 * identical three. A judge who reads one and then sees the other is being told
 * two different stories, which is worse than telling neither.
 *
 * Lives here rather than in the panel so the landing page can use it without
 * pulling the panel, the proposal store and the activity store into its bundle.
 */
export const TRY_ASKING = [
  'Design a happy birthday flyer for my mum',
  'Make these two bigger and line them up',
  'Now make an Instagram story version',
] as const
