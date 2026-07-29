import { Card, CardContent } from "@/components/ui/card"

export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <Card className="border-border bg-card">
      <CardContent className="px-6 py-5">
        <p className="text-3xl font-semibold tracking-tight">{value}</p>
        <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  )
}
