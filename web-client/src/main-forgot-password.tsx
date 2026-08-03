import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { ThemeProvider } from "@/components/theme-provider"
import { ForgotPasswordPage } from "@/pages/ForgotPasswordPage"
import "@/styles/globals.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ForgotPasswordPage />
    </ThemeProvider>
  </StrictMode>,
)
