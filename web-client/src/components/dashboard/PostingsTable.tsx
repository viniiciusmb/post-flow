import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { StatusBadge } from "@/components/dashboard/StatusBadge"
import type { PostingStatus } from "@/types/api"

export interface PostingRow {
  id: number
  filename: string
  status: PostingStatus
  date: string
  clientName?: string
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString("pt-BR")
}

export function PostingsTable({
  rows,
  showClient = false,
  emptyMessage,
}: {
  rows: PostingRow[]
  showClient?: boolean
  emptyMessage: string
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {showClient && <TableHead>Cliente</TableHead>}
            <TableHead>Vídeo</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Data</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              {showClient && (
                <TableCell className="font-medium">{row.clientName}</TableCell>
              )}
              <TableCell className="text-muted-foreground">{row.filename}</TableCell>
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
