import { Button } from "@/components/ui/button"
import type { SessionUser } from "@/types/api"

const ADMIN_LINKS = [
  { href: "/admin", label: "Painel" },
  { href: "/admin/clients", label: "Clientes" },
  { href: "/admin/postings", label: "Postagens" },
  { href: "/admin/drive", label: "Google Drive" },
]

const CLIENT_LINKS = [{ href: "/client", label: "Meu Painel" }]

export function TopNav({
  user,
  onLogout,
}: {
  user: SessionUser | null
  onLogout: () => void
}) {
  const links = user?.role === "admin" ? ADMIN_LINKS : CLIENT_LINKS

  return (
    <header className="border-b border-border">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-6">
        <div className="flex items-center gap-8">
          <span className="text-sm font-semibold tracking-tight">Post Flow</span>
          <nav className="flex items-center gap-1">
            {links.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
        </div>

        {user && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{user.email}</span>
            <Button variant="outline" size="sm" onClick={onLogout}>
              Sair
            </Button>
          </div>
        )}
      </div>
    </header>
  )
}
