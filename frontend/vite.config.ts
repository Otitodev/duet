import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

const require = createRequire(import.meta.url)

const proEditorSidebarIconsModule = fileURLToPath(
  new URL('./src/lib/editor-sidebar-icons.pro.ts', import.meta.url),
)

const proHugeiconsBrandIconModule = fileURLToPath(
  new URL('./src/lib/hugeicons-brand-icon.pro.ts', import.meta.url),
)

const hasHugeiconsPro = (() => {
  try {
    require.resolve('@hugeicons-pro/core-solid-rounded/package.json')
    return true
  } catch {
    return false
  }
})()

const config = defineConfig(() => {
  console.info(
    `[icons] ${hasHugeiconsPro ? 'Hugeicons Pro detected' : 'Hugeicons Pro not installed; using free fallback'}`,
  )
  return {
    base: '/',
    resolve: {
      tsconfigPaths: true,
      alias: [
        ...(hasHugeiconsPro
          ? [
              {
                find: /^@\/lib\/editor-sidebar-icons$/,
                replacement: proEditorSidebarIconsModule,
              },
              {
                find: /^@\/lib\/hugeicons-brand-icon$/,
                replacement: proHugeiconsBrandIconModule,
              },
            ]
          : []),
      ],
    },
    plugins: [tanstackRouter({ target: 'react' }), tailwindcss(), viteReact()],
  }
})

export default config
