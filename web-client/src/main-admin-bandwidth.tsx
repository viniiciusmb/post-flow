import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { AdminBandwidthPage } from "@/pages/AdminBandwidthPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AdminBandwidthPage />
    </ThemeProvider>
  </StrictMode>,
)
