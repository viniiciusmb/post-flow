import { useEffect, type ReactNode } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { SiteHeader } from "@/components/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { GuidedTour } from "@/components/tour/GuidedTour"
import { ClientNoticeDialog } from "@/components/dashboard/ClientNoticeDialog"
import { PagamentoPendenteDialog } from "@/components/dashboard/PagamentoPendenteDialog"
import { useAuth } from "@/hooks/useAuth"
import { instalarRelatorioDeErros } from "@/lib/reportarErroDeTela"
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
  // O layout monta o menu, então é ele que precisa saber se "Sua conexão"
  // aparece. Reaproveita a MESMA requisição que a página já fez (ver useAuth).
  const { mostrarTunel, painelNovo, plano } = useAuth()
  // Mensalidade vencida: tudo fica atrás do aviso, menos onde ela se paga.
  const pagamentoPendente =
    user.role === "client" &&
    plano?.situacao === "inadimplente" &&
    !/^\/client\/(billing|checkout)/.test(typeof window === "undefined" ? "" : window.location.pathname)
  // Erro de JavaScript de qualquer tela vai pro painel de erros do admin.
  useEffect(() => {
    instalarRelatorioDeErros()
  }, [])

  return (
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 64)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar user={user} onLogout={onLogout} mostrarTunel={mostrarTunel} painelNovo={painelNovo} variant="inset" />
      <SidebarInset>
        <SiteHeader title={title} maquina={painelNovo ? (user.role === "admin" ? "sistema" : "cliente") : null} />
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
      {/* Com a mensalidade em aberto o tour não abre: ele cobria o aviso de pagamento. */}
      {!pagamentoPendente && <GuidedTour autoIniciar={autoIniciarTour} />}
      {/* Admin não recebe aviso de cliente: a rota é de cliente, e o painel
          dele não tem nada para mostrar aqui. */}
      {user.role === "client" && !pagamentoPendente && <ClientNoticeDialog />}
      {pagamentoPendente && <PagamentoPendenteDialog onLogout={onLogout} />}
    </SidebarProvider>
  )
}
