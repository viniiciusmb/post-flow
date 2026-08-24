import type { ReactNode } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { GuidedTour } from "@/components/tour/GuidedTour"
import type { SessionUser } from "@/types/api"

export function DashboardLayout({
  user,
  onLogout,
  title,
  children,
  autoIniciarTour = false,
}: {
  user: SessionUser
  onLogout: () => void
  title: string
  children: ReactNode
  /** Só a tela inicial liga isto: o tour abre sozinho na primeira visita. */
  autoIniciarTour?: boolean
}) {
  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar user={user} onLogout={onLogout} variant="inset" />
      <SidebarInset>
        <SiteHeader title={title} />
        <div className="flex flex-1 flex-col">
          {/* Largura máxima: linha de texto longa demais cansa de ler, e num
              monitor grande o conteúdo esticado de ponta a ponta é o que mais
              denuncia painel improvisado. */}
          <div className="@container/main mx-auto flex w-full max-w-[1400px] flex-1 flex-col gap-5 p-4 pb-16 lg:gap-6 lg:px-8 lg:py-7">
            {children}
          </div>
        </div>
      </SidebarInset>
      {/* Montado no layout, e não em cada página: o tour atravessa telas, e
          precisa existir na tela de destino pra retomar depois da navegação. */}
      <GuidedTour autoIniciar={autoIniciarTour} />
    </SidebarProvider>
  )
}
