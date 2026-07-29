import type { ReactNode } from "react"
import { TopNav } from "./TopNav"
import type { SessionUser } from "@/types/api"

export function AppShell({
  user,
  onLogout,
  title,
  children,
}: {
  user: SessionUser | null
  onLogout: () => void
  title: string
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-background">
      <TopNav user={user} onLogout={onLogout} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <h1 className="mb-8 text-2xl font-semibold tracking-tight">{title}</h1>
        {children}
      </main>
    </div>
  )
}
