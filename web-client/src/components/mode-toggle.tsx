import { Moon, Sun } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useTheme } from "@/components/theme-provider"
import { useT } from "@/i18n"

export function ModeToggle() {
  const { setTheme } = useTheme()
  const t = useT()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Sun className="scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
          <Moon className="absolute scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
          <span className="sr-only">{t("tema.alternar")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => setTheme("light")}>{t("tema.claro")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>{t("tema.escuro")}</DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>{t("tema.sistema")}</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
