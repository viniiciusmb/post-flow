import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { YouTubeChannelsPage } from "@/pages/YouTubeChannelsPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <YouTubeChannelsPage />
    </ThemeProvider>
  </StrictMode>,
)
