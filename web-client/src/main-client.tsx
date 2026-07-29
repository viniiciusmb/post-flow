import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { ClientDashboardPage } from "@/pages/ClientDashboardPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ClientDashboardPage />
    </ThemeProvider>
  </StrictMode>,
)
