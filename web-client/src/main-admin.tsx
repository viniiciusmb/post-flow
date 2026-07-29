import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { AdminDashboardPage } from "@/pages/AdminDashboardPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AdminDashboardPage />
  </StrictMode>,
)
