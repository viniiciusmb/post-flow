import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { ClientTunnelPage } from "@/pages/ClientTunnelPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ClientTunnelPage />
    </ThemeProvider>
  </StrictMode>,
)
