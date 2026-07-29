import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { AdminMetricsPage } from "@/pages/AdminMetricsPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AdminMetricsPage />
    </ThemeProvider>
  </StrictMode>,
)
