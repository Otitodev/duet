export function readClipboardImageFiles(): Promise<File[]> {
  const read = navigator.clipboard?.read
  if (!read) return Promise.resolve([])
  return read.call(navigator.clipboard).then(async (items: ClipboardItem[]) => {
    const files: File[] = []
    for (const item of items) {
      const imageType = item.types.find(type => type.startsWith('image/'))
      if (!imageType) continue
      const blob = await item.getType(imageType)
      const ext = imageType.split('/')[1]?.split('+')[0] || 'png'
      files.push(
        new File([blob], `clipboard-image.${ext}`, {
          type: imageType,
        }),
      )
    }
    return files
  })
}

export function isImageFile(file: File): boolean {
  if (file.type.startsWith('image/')) return true
  return /\.(avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(file.name)
}

/**
 * Read a file as a data URL.
 *
 * Data URLs, rather than object URLs, because the result is persisted and
 * re-rendered later: a blob: URL dies with the page, and an image loaded from
 * one cannot be exported without tainting the canvas.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`))
    reader.readAsDataURL(file)
  })
}

export function transferMayContainFiles(dt: DataTransfer | null): boolean {
  if (!dt) return false
  return Array.from(dt.types).some(type => type === 'Files' || type === 'application/x-moz-file')
}

export function imageFilesFromTransfer(dt: DataTransfer | null): File[] {
  if (!dt) return []
  const files = Array.from(dt.files).filter(isImageFile)
  const itemFiles = Array.from(dt.items)
    .filter(item => item.kind === 'file')
    .map(item => item.getAsFile())
    .filter((file): file is File => !!file && isImageFile(file))
  const seen = new Set<string>()
  return [...files, ...itemFiles].filter(file => {
    const key = `${file.name}:${file.size}:${file.type}:${file.lastModified}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
