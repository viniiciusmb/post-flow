import { Languages } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { IDIOMAS, useI18n } from "@/i18n"

/**
 * Seletor de idioma, irmão do seletor de tema.
 *
 * Trocar o idioma recarrega a página. Parece exagero num app React, mas as
 * páginas públicas (landing, termos, privacidade) são montadas no servidor a
 * partir do cookie `lang` — sem o recarregamento, o painel trocaria de idioma e
 * um link pro rodapé abriria em português mesmo assim. Recarregar deixa os dois
 * lados sempre no mesmo idioma.
 */
export function LanguageToggle() {
  const { idioma, setIdioma, t } = useI18n()

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon">
          <Languages />
          <span className="sr-only">{t("idioma.escolher")}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {IDIOMAS.map((op) => (
          <DropdownMenuItem
            key={op.code}
            onClick={() => {
              if (op.code === idioma) return
              setIdioma(op.code)
              window.location.reload()
            }}
            className={op.code === idioma ? "font-medium" : undefined}
          >
            <span className="mr-2">{op.flag}</span>
            {op.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
