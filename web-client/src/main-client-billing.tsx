import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { ClientBillingPage } from "@/pages/ClientBillingPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ClientBillingPage />
    </ThemeProvider>
  </StrictMode>,
)
