import type { ReactNode } from "react"
import { BrandMark } from "@/components/brand-mark"
import { ProductPreview } from "@/pages/LoginPage"

// Moldura das telas de entrada (login, esqueci a senha, nova senha): marca em
// cima, conteúdo no meio, aviso legal embaixo, e a mesma prévia do produto do
// lado direito. Fica num arquivo só pra que trocar o visual do login mude as
// três telas juntas - senão elas desencontram na primeira mexida.
export function AuthShell({
  titulo,
  descricao,
  children,
  rodape,
}: {
  titulo: string
  descricao: ReactNode
  children: ReactNode
  rodape?: ReactNode
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(360px,480px)_1fr]">
      <div className="flex flex-col justify-between px-8 py-10 sm:px-14">
        <a href="/login" className="flex items-center gap-2.5">
          <BrandMark className="size-7.5" />
          <span className="font-heading text-lg font-bold tracking-tight">Post Flow</span>
        </a>

        <div className="mx-auto w-full max-w-[340px]">
          <div className="mb-8">
            <h1 className="font-heading text-[28px] font-semibold tracking-tight">{titulo}</h1>
            <p className="mt-2 text-[14.5px] leading-relaxed text-muted-foreground">{descricao}</p>
          </div>

          {children}
        </div>

        <p className="mx-auto max-w-[340px] text-center text-xs leading-relaxed text-muted-foreground/70">
          {rodape ?? (
            <>
              Precisa de ajuda? Escreva para{" "}
              <a href="mailto:contato@postflowtiktok.com" className="underline">
                contato@postflowtiktok.com
              </a>
            </>
          )}
        </p>
      </div>

      <ProductPreview />
    </div>
  )
}

export function AuthErro({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      {children}
    </p>
  )
}
