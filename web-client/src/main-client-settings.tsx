import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { ClientSettingsPage } from "@/pages/ClientSettingsPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ClientSettingsPage />
    </ThemeProvider>
  </StrictMode>,
)
