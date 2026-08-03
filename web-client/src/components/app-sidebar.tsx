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

// Os nomes do menu descrevem o que a PESSOA controla, nao como o sistema foi
// construido. Foi por isso que "Túnel" virou "Sua conexão": tunel e o nome da
// tecnica (um tunel SSH reverso), nao do beneficio, e ninguem que produz
// conteudo abre um menu chamado "Túnel esperando entender o que tem la dentro.
// Mesma logica em "Fila de Processamento" -> "Processamento" e
// "Vídeos & Cortes" -> "Cortes" (o "&" e a palavra "vídeos" nao acrescentavam
// nada: o que o cliente vem procurar aqui e o corte).
const ADMIN_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [{ title: "Início", url: "/admin", icon: IconLayoutDashboard }],
  },
  {
    label: "Operação",
    items: [
      { title: "Clientes", url: "/admin/clients", icon: IconUsers },
      { title: "Publicações", url: "/admin/postings", icon: IconListDetails },
      { title: "Processamento", url: "/admin/queue", icon: IconListCheck },
      { title: "Métricas", url: "/admin/metrics", icon: IconChartBar },
      { title: "Consumo de banda", url: "/admin/bandwidth", icon: IconGauge },
      { title: "Assinaturas", url: "/admin/billing", icon: IconReceipt2 },
      { title: "Erros", url: "/admin/errors", icon: IconAlertTriangle },
    ],
  },
  {
    label: "Meu conteúdo",
    items: [
      { title: "Canais", url: "/client/youtube-channels", icon: IconBrandYoutube },
      { title: "Cortes", url: "/client/videos-clips", icon: IconScissors },
      { title: "Publicação", url: "/client/tiktok-account", icon: IconBrandTiktok },
      { title: "Configurações", url: "/client/settings", icon: IconSettings },
    ],
  },
]

const CLIENT_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { title: "Início", url: "/client", icon: IconLayoutDashboard },
      { title: "Canais", url: "/client/youtube-channels", icon: IconBrandYoutube },
      { title: "Cortes", url: "/client/videos-clips", icon: IconScissors },
      { title: "Publicação", url: "/client/tiktok-account", icon: IconBrandTiktok },
      { title: "Sua conexão", url: "/client/tunnel", icon: IconRouter },
      { title: "Plano e uso", url: "/client/billing", icon: IconReceipt2 },
      { title: "Configurações", url: "/client/settings", icon: IconSettings },
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
  const groups = user.role === "admin" ? ADMIN_GROUPS : CLIENT_GROUPS

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
