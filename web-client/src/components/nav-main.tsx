import type { Icon } from "@tabler/icons-react"

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

export interface NavItem {
  title: string
  url: string
  icon: Icon
}

function NavGroup({ label, items }: { label?: string; items: NavItem[] }) {
  const currentPath = window.location.pathname

  return (
    <SidebarGroup>
      {label && <SidebarGroupLabel>{label}</SidebarGroupLabel>}
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              <SidebarMenuButton
                asChild
                tooltip={item.title}
                isActive={currentPath === item.url}
              >
                <a href={item.url}>
                  <item.icon />
                  <span>{item.title}</span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

export function NavMain({
  items,
  groups,
}: {
  items?: NavItem[]
  groups?: { label?: string; items: NavItem[] }[]
}) {
  if (groups) {
    return (
      <>
        {groups.map((group) => (
          <NavGroup key={group.label ?? "main"} label={group.label} items={group.items} />
        ))}
      </>
    )
  }
  return <NavGroup items={items ?? []} />
}
