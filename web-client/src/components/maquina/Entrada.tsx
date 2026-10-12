import type { ReactNode } from "react"
import { IconBrandTwitch, IconBrandYoutubeFilled } from "@tabler/icons-react"
import { Avatares, ha, hhmmss, plural, type Maquina } from "./comum"

/**
 * As duas entradas da linha: o vigia dos canais do YouTube e as lives
 * monitoradas. Cada uma desce pela própria primeira etapa (download /
 * gravação) e as duas se juntam na transcrição - ver Linha.tsx.
 */

function Lampada({ viva, cor, rotulo }: { viva: boolean; cor: string; rotulo: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className="maq-lampada" data-viva={viva} style={{ color: cor }} aria-hidden="true" />
      {rotulo}
    </span>
  )
}

function Cabecalho({ icone, cor, titulo, sub, lado }: { icone: ReactNode; cor: string; titulo: string; sub: string; lado: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg text-white" style={{ background: cor }}>
          {icone}
        </span>
        <div className="min-w-0">
          <p className="text-[13px] leading-tight font-medium">{titulo}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">{sub}</p>
        </div>
      </div>
      {lado}
    </div>
  )
}

// A borda de cima na cor da origem amarra o cartão à coluna dele.
const CARTAO = "flex min-w-0 flex-col rounded-lg border border-border border-t-[3px] border-t-[var(--maq-work)] bg-background/50 p-3.5 dark:bg-muted/30"

export function FonteYouTube({ d, agora }: { d: Maquina; agora: number }) {
  const esperando = d.proximosNaLinha
  const ativo = d.fontes.canaisAtivos > 0
  const sub = ativo
    ? `${plural(d.fontes.canaisAtivos, "canal vigiado", "canais vigiados")}${
        d.fontes.ultimaChecagem ? ` · checou ${ha(agora - new Date(d.fontes.ultimaChecagem).getTime())}` : ""
      }`
    : "Nenhum canal ligado"

  return (
    <div className={CARTAO}>
      <Cabecalho
        icone={<IconBrandYoutubeFilled className="size-[18px]" />}
        cor="#FF0000"
        titulo="Vigia do YouTube"
        sub={sub}
        lado={<Lampada viva={ativo} cor="var(--maq-flow)" rotulo={ativo ? "vigiando" : "parado"} />}
      />
      {d.fontes.canais.length > 0 && (
        <div className="mt-3">
          <Avatares itens={d.fontes.canais} />
        </div>
      )}
      <div className="mt-3 border-t border-border/70 pt-2.5">
        {esperando.length > 0 ? (
          <>
            <p className="mb-1.5 text-[11.5px] font-medium text-[var(--maq-hold)]">
              {plural(d.etapas.esperando, "vídeo esperando a vez", "vídeos esperando a vez")}
            </p>
            <ul className="flex flex-col gap-1.5">
              {esperando.slice(0, 2).map((v) => (
                <li key={v.id} className="flex min-w-0 items-center gap-2">
                  <span className="block h-[20px] w-[34px] shrink-0 overflow-hidden rounded-[4px] bg-muted">
                    {v.thumbnailUrl && <img src={v.thumbnailUrl} alt="" className="size-full object-cover" loading="lazy" />}
                  </span>
                  <span className="min-w-0 truncate text-[12px] text-muted-foreground">{v.titulo}</span>
                </li>
              ))}
            </ul>
          </>
        ) : ativo ? (
          <p className="text-[11.5px] text-muted-foreground">Nenhum vídeo esperando. Um vídeo novo entra assim que o canal publicar.</p>
        ) : (
          <a href="/client/youtube" className="text-[11.5px] text-[var(--signal)] hover:underline">
            Ligar um canal do YouTube
          </a>
        )}
      </div>
    </div>
  )
}

export function FonteLives({ d, agora }: { d: Maquina; agora: number }) {
  const aoVivo = d.aoVivo
  const ativas = d.fontes.livesSeguidas > 0
  return (
    <div className={CARTAO}>
      <Cabecalho
        icone={<IconBrandTwitch className="size-[18px]" />}
        cor="#9146FF"
        titulo="Lives monitoradas"
        sub={ativas ? plural(d.fontes.livesSeguidas, "canal acompanhado", "canais acompanhados") : "Nenhuma live acompanhada"}
        lado={
          aoVivo.length > 0 ? (
            <Lampada viva cor="var(--maq-rec)" rotulo={`${aoVivo.length} ao vivo`} />
          ) : (
            <Lampada viva={false} cor="var(--muted-foreground)" rotulo={ativas ? "offline" : "parado"} />
          )
        }
      />
      {d.fontes.lives.length > 0 && (
        <div className="mt-3">
          <Avatares itens={d.fontes.lives.map((l) => ({ id: l.id, nome: l.nome, avatarUrl: l.avatarUrl, destaque: l.aoVivo }))} anel="var(--maq-live)" />
        </div>
      )}
      <div className="mt-3 border-t border-border/70 pt-2.5">
        {aoVivo.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {aoVivo.slice(0, 2).map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate">
                  <span className="font-medium">{l.nome}</span>
                  <span className="text-muted-foreground"> entrou ao vivo</span>
                </span>
                <span className="num flex shrink-0 items-center gap-1.5 text-[11.5px] text-[var(--maq-rec)]">
                  <span className="maq-rec size-1.5 rounded-full bg-[var(--maq-rec)]" aria-hidden="true" />
                  {hhmmss((agora - new Date(l.gravandoDesde).getTime()) / 1000)}
                </span>
              </li>
            ))}
          </ul>
        ) : ativas ? (
          <p className="text-[11.5px] text-muted-foreground">Nenhum canal ao vivo agora. A gravação começa sozinha quando entrarem.</p>
        ) : (
          <a href="/client/lives" className="text-[11.5px] text-[var(--signal)] hover:underline">
            Acompanhar uma live
          </a>
        )}
      </div>
    </div>
  )
}
