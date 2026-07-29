import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { AdminDashboardPage } from "@/pages/AdminDashboardPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AdminDashboardPage />
    </ThemeProvider>
  </StrictMode>,
)
