import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { I18nProvider } from "@/i18n"
import { TikTokAccountPage } from "@/pages/TikTokAccountPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <I18nProvider>
        <TikTokAccountPage />
      </I18nProvider>
    </ThemeProvider>
  </StrictMode>,
)
