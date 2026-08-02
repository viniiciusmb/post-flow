import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { ModeToggle } from "@/components/mode-toggle"

/**
 * Barra fina do topo.
 *
 * O título da tela saiu daqui e virou o PageHeader dentro do conteúdo, junto
 * com a descrição e a ação principal. Repetir o nome nos dois lugares só
 * ocupava a primeira linha útil da tela sem acrescentar nada; aqui em cima
 * ficam só os controles do próprio painel.
 *
 * A barra é translúcida com desfoque e gruda no topo: o conteúdo passa por
 * baixo dela ao rolar, em vez de a página inteira empurrar um bloco sólido.
 */
export function SiteHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-10 flex h-(--header-height) shrink-0 items-center gap-2 border-b bg-background/72 backdrop-blur-xl">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        {/* Fica só como pista de contexto quando a barra lateral está recolhida. */}
        <span className="text-sm font-medium text-muted-foreground">{title}</span>
        <div className="ml-auto flex items-center gap-2">
          <ModeToggle />
        </div>
      </div>
    </header>
  )
}
