import { dataHora } from "@/lib/formatoLocal"
import { useT } from "@/i18n"
import { EmptyState } from "@/components/dashboard/EmptyState"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/dashboard/StatusBadge"
import { OriginBadge } from "@/components/dashboard/OriginBadge"
import type { PostingOrigin, PostingStatus } from "@/types/api"

export interface PostingRow {
  id: number
  filename: string
  status: PostingStatus
  date: string
  clientName?: string
  origin?: PostingOrigin
  channelName?: string | null
  tiktokDisplayName?: string | null
}

function formatDate(iso: string) {
  return dataHora(iso)
}

export function PostingsTable({
  rows,
  showClient = false,
  showOrigin = false,
  showChannel = false,
  showTiktokProfile = false,
  emptyMessage,
}: {
  rows: PostingRow[]
  showClient?: boolean
  showOrigin?: boolean
  showChannel?: boolean
  showTiktokProfile?: boolean
  emptyMessage: string
}) {
  const t = useT()
  if (rows.length === 0) {
    return (
      <EmptyState title={t("tabela.vazio")} description={emptyMessage} compact />
    )
  }

  return (
    <div className="overflow-hidden rounded-xl bg-card shadow-[var(--shadow-flat)] dark:border dark:border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {showClient && <TableHead>{t("tabela.cliente")}</TableHead>}
            <TableHead>{t("tabela.video")}</TableHead>
            {showChannel && <TableHead>{t("tabela.canal")}</TableHead>}
            {showOrigin && <TableHead>{t("tabela.origem")}</TableHead>}
            {showTiktokProfile && <TableHead>Perfil TikTok</TableHead>}
            <TableHead>{t("tabela.status")}</TableHead>
            <TableHead className="text-right">{t("tabela.data")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {showClient && (
                <TableCell className="font-medium">{row.clientName}</TableCell>
              )}
              <TableCell className="max-w-70 truncate font-medium">{row.filename}</TableCell>
              {showChannel && (
                <TableCell className="text-muted-foreground">{row.channelName ?? "—"}</TableCell>
              )}
              {showOrigin && <TableCell>{row.origin && <OriginBadge origin={row.origin} />}</TableCell>}
              {showTiktokProfile && (
                <TableCell className="text-muted-foreground">{row.tiktokDisplayName ?? "—"}</TableCell>
              )}
              <TableCell>
                <StatusBadge status={row.status} />
              </TableCell>
              <TableCell className="text-right text-muted-foreground">
                {formatDate(row.date)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}
