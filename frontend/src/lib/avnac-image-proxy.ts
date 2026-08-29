/**
 * Duet runs with no backend, so there is no media proxy to route remote images
 * through. Images here arrive as `data:` or `blob:` URLs from local file drops,
 * which are already export safe. Remote http(s) URLs pass through unchanged:
 * they display, but may taint the canvas and break PNG export if the host sends
 * no CORS headers. Accepted edge case — image pipelines are out of scope.
 */
export function getExportSafeImageUrl(raw: string): string {
  return raw.trim()
}

export async function loadImageMetadata(rawUrl: string): Promise<{
  src: string
  naturalWidth: number
  naturalHeight: number
}> {
  const src = getExportSafeImageUrl(rawUrl)
  const img = new Image()
  if (!src.startsWith('data:') && !src.startsWith('blob:')) {
    img.crossOrigin = 'anonymous'
  }
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error(`Could not load image: ${rawUrl}`))
    img.src = src
  })
  return {
    src,
    naturalWidth: Math.max(1, img.naturalWidth || img.width || 1),
    naturalHeight: Math.max(1, img.naturalHeight || img.height || 1),
  }
}
