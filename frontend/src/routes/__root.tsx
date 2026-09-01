import { createRootRoute, Outlet } from '@tanstack/react-router'

import NativeTitleTooltip from '../components/native-title-tooltip'
import WebMcpEntryHost from '../components/webmcp-entry-host'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  return (
    <>
      <NativeTitleTooltip />
      <WebMcpEntryHost />
      <Outlet />
    </>
  )
}
