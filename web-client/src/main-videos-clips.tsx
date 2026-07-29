import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { VideosClipsPage } from "@/pages/VideosClipsPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <VideosClipsPage />
    </ThemeProvider>
  </StrictMode>,
)
