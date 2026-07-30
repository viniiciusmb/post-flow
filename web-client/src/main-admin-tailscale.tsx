import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { AdminTailscalePage } from "@/pages/AdminTailscalePage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AdminTailscalePage />
    </ThemeProvider>
  </StrictMode>,
)
