import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { AdminQueuePage } from "@/pages/AdminQueuePage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <AdminQueuePage />
    </ThemeProvider>
  </StrictMode>,
)
