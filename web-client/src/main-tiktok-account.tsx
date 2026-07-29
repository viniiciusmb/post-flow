import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { TikTokAccountPage } from "@/pages/TikTokAccountPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <TikTokAccountPage />
    </ThemeProvider>
  </StrictMode>,
)
