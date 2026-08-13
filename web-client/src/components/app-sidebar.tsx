import {
  IconLayoutDashboard,
  IconUsers,
  IconListDetails,
  IconBrandYoutube,
  IconScissors,
  IconListCheck,
  IconBrandTiktok,
  IconChartBar,
  IconSettings,
  IconGauge,
  IconRouter,
  IconReceipt2,
  IconAlertTriangle,
  IconGift,
} from "@tabler/icons-react"

import { NavMain, type NavItem } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { BrandMark } from "@/components/brand-mark"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import type { SessionUser } from "@/types/api"
import { useT, type ChaveDeTraducao } from "@/i18n"

// Os nomes do menu descrevem o que a PESSOA controla, nao como o sistema foi
// construido. Foi por isso que "Túnel" virou "Sua conexão": tunel e o nome da
// tecnica (um tunel SSH reverso), nao do beneficio, e ninguem que produz
// conteudo abre um menu chamado "Túnel esperando entender o que tem la dentro.
// Mesma logica em "Fila de Processamento" -> "Processamento" e
// "Vídeos & Cortes" -> "Cortes" (o "&" e a palavra "vídeos" nao acrescentavam
// nada: o que o cliente vem procurar aqui e o corte).
// Os grupos guardam a chave de tradução, não o texto: o menu é montado na
// hora de desenhar, com o idioma que estiver valendo.
type Grupo = { label?: ChaveDeTraducao; items: (Omit<NavItem, "title"> & { title: ChaveDeTraducao })[] }

const ADMIN_GROUPS: Grupo[] = [
  {
    items: [{ title: "menu.inicio", url: "/admin", icon: IconLayoutDashboard }],
  },
  {
    label: "menu.grupoOperacao",
    items: [
      { title: "menu.clientes", url: "/admin/clients", icon: IconUsers },
      { title: "menu.postagens", url: "/admin/postings", icon: IconListDetails },
      { title: "menu.processamento", url: "/admin/queue", icon: IconListCheck },
      { title: "menu.metricas", url: "/admin/metrics", icon: IconChartBar },
      { title: "menu.banda", url: "/admin/bandwidth", icon: IconGauge },
      { title: "menu.assinaturas", url: "/admin/billing", icon: IconReceipt2 },
      { title: "menu.comissoes", url: "/admin/commissions", icon: IconGift },
      { title: "menu.erros", url: "/admin/errors", icon: IconAlertTriangle },
    ],
  },
  {
    label: "menu.grupoMeuConteudo",
    items: [
      { title: "menu.canais", url: "/client/youtube-channels", icon: IconBrandYoutube },
      { title: "menu.cortes", url: "/client/videos-clips", icon: IconScissors },
      { title: "menu.publicacao", url: "/client/tiktok-account", icon: IconBrandTiktok },
      { title: "menu.configuracoes", url: "/client/settings", icon: IconSettings },
    ],
  },
]

const CLIENT_GROUPS: Grupo[] = [
  {
    items: [
      { title: "menu.inicio", url: "/client", icon: IconLayoutDashboard },
      { title: "menu.canais", url: "/client/youtube-channels", icon: IconBrandYoutube },
      { title: "menu.cortes", url: "/client/videos-clips", icon: IconScissors },
      { title: "menu.publicacao", url: "/client/tiktok-account", icon: IconBrandTiktok },
      { title: "menu.conexao", url: "/client/tunnel", icon: IconRouter },
      { title: "menu.planoEUso", url: "/client/billing", icon: IconReceipt2 },
      { title: "menu.comissoes", url: "/client/commissions", icon: IconGift },
      { title: "menu.configuracoes", url: "/client/settings", icon: IconSettings },
    ],
  },
]

export function AppSidebar({
  user,
  onLogout,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: SessionUser
  onLogout: () => void
}) {
  const t = useT()
  const grupos = user.role === "admin" ? ADMIN_GROUPS : CLIENT_GROUPS
  const groups: { label?: string; items: NavItem[] }[] = grupos.map((g) => ({
    label: g.label ? t(g.label) : undefined,
    items: g.items.map((i) => ({ ...i, title: t(i.title) })),
  }))

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <a href={user.role === "admin" ? "/admin" : "/client"}>
                <BrandMark className="size-6" />
                <span className="font-heading text-base font-semibold">Post Flow</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain groups={groups} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onLogout={onLogout} />
      </SidebarFooter>
    </Sidebar>
  )
}
