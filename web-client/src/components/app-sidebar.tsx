import {
  IconLayoutDashboard,
  IconUsers,
  IconListDetails,
  IconBrandGoogleDrive,
  IconBrandYoutube,
  IconScissors,
  IconListCheck,
  IconBrandTiktok,
  IconChartBar,
  IconSettings,
  IconRouter,
  IconGauge,
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

const ADMIN_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    label: "Menu",
    items: [{ title: "Painel", url: "/admin", icon: IconLayoutDashboard }],
  },
  {
    label: "Gestão",
    items: [
      { title: "Clientes", url: "/admin/clients", icon: IconUsers },
      { title: "Postagens", url: "/admin/postings", icon: IconListDetails },
      { title: "Fila de Processamento", url: "/admin/queue", icon: IconListCheck },
      { title: "Google Drive", url: "/admin/drive", icon: IconBrandGoogleDrive },
      { title: "Métricas", url: "/admin/metrics", icon: IconChartBar },
      { title: "Banda", url: "/admin/bandwidth", icon: IconGauge },
      { title: "Tailscale", url: "/admin/tailscale", icon: IconRouter },
    ],
  },
  {
    label: "Meu conteúdo",
    items: [
      { title: "Canais do YouTube", url: "/client/youtube-channels", icon: IconBrandYoutube },
      { title: "Vídeos & Cortes", url: "/client/videos-clips", icon: IconScissors },
      { title: "Contas TikTok", url: "/client/tiktok-account", icon: IconBrandTiktok },
      { title: "Configurações", url: "/client/settings", icon: IconSettings },
    ],
  },
]

const CLIENT_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    label: "Menu",
    items: [
      { title: "Dashboard", url: "/client", icon: IconLayoutDashboard },
      { title: "Canais do YouTube", url: "/client/youtube-channels", icon: IconBrandYoutube },
      { title: "Vídeos & Cortes", url: "/client/videos-clips", icon: IconScissors },
      { title: "Contas TikTok", url: "/client/tiktok-account", icon: IconBrandTiktok },
      { title: "Túnel", url: "/client/tunnel", icon: IconRouter },
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
