import {
  IconLayoutDashboard,
  IconUsers,
  IconListDetails,
  IconBrandGoogleDrive,
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

const ADMIN_NAV: NavItem[] = [
  { title: "Painel", url: "/admin", icon: IconLayoutDashboard },
  { title: "Clientes", url: "/admin/clients", icon: IconUsers },
  { title: "Postagens", url: "/admin/postings", icon: IconListDetails },
  { title: "Google Drive", url: "/admin/drive", icon: IconBrandGoogleDrive },
]

const CLIENT_NAV: NavItem[] = [
  { title: "Meu Painel", url: "/client", icon: IconLayoutDashboard },
]

export function AppSidebar({
  user,
  onLogout,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: SessionUser
  onLogout: () => void
}) {
  const items = user.role === "admin" ? ADMIN_NAV : CLIENT_NAV

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
        <NavMain items={items} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} onLogout={onLogout} />
      </SidebarFooter>
    </Sidebar>
  )
}
