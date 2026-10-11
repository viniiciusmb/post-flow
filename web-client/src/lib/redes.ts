import type { ComponentType } from "react"
import {
  IconBrandBluesky,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandLinkedin,
  IconBrandPinterest,
  IconBrandThreads,
  IconBrandTiktok,
  IconBrandYoutubeFilled,
} from "@tabler/icons-react"

/**
 * As redes onde os cortes são publicados, na ordem em que aparecem na tela.
 *
 * Os limites de duração repetem os do servidor (src/lib/redesSociais.js), que é
 * quem decide de verdade; aqui servem só pra tela avisar antes. O texto das
 * exigências é o que evita a frustração mais comum: conectar, ver tudo
 * "certo" e descobrir depois que a conta era do tipo errado.
 */
export type Rede = "tiktok" | "instagram" | "facebook" | "youtube" | "threads" | "linkedin" | "pinterest" | "bluesky"

export type InfoDaRede = {
  nome: string
  Icone: ComponentType<{ className?: string }>
  /** Cor da marca, usada em detalhes (borda, marcação na régua). */
  cor: string
  /** Fundo do ícone (algumas marcas são degradê). */
  fundo: string
  /** O que vira o corte nessa rede, já escrito pra entrar no meio de uma frase. */
  formato: string
  duracaoMaxS: number
  exigencias: { chave: string; valor: string; detalhe?: string }[]
  comoPreparar?: string[]
  /** Aviso que só essa rede tem (limite compartilhado do YouTube). */
  aviso?: string
}

export const REDES: Record<Rede, InfoDaRede> = {
  tiktok: {
    nome: "TikTok",
    Icone: IconBrandTiktok,
    cor: "#FE2C55",
    fundo: "linear-gradient(135deg, #111 0%, #111 55%, #25F4EE 140%)",
    formato: "vídeo no perfil",
    duracaoMaxS: 600,
    exigencias: [
      { chave: "Conta", valor: "Qualquer conta", detalhe: "Pessoal ou empresa." },
      { chave: "Formato", valor: "Vertical 9:16" },
    ],
  },
  instagram: {
    nome: "Instagram",
    Icone: IconBrandInstagram,
    cor: "#DD2A7B",
    fundo: "linear-gradient(45deg, #F58529 0%, #DD2A7B 45%, #8134AF 75%, #515BD4 100%)",
    formato: "Reels",
    duracaoMaxS: 90,
    exigencias: [
      { chave: "Conta", valor: "Profissional", detalhe: "Criador de conteúdo ou Empresa." },
      { chave: "Duração", valor: "Até 90 segundos", detalhe: "Cortes mais longos não são publicados no Instagram." },
      { chave: "Limite", valor: "100 por dia", detalhe: "Por conta." },
    ],
    comoPreparar: [
      "No app do Instagram, abra o perfil e toque em ☰.",
      "Tipo de conta e ferramentas → Mudar para conta profissional.",
      "Escolha Criador de conteúdo ou Empresa.",
    ],
  },
  facebook: {
    nome: "Facebook",
    Icone: IconBrandFacebook,
    cor: "#1877F2",
    fundo: "#1877F2",
    formato: "Reels da Página",
    duracaoMaxS: 90,
    exigencias: [
      { chave: "Onde publica", valor: "Página", detalhe: "Perfil pessoal não pode receber publicação por aplicativo." },
      { chave: "Acesso", valor: "Administrador da Página" },
      { chave: "Duração", valor: "Até 90 segundos" },
    ],
    comoPreparar: ["Entre com o perfil que administra a Página.", "Na volta, marque as Páginas que vão receber os cortes."],
  },
  youtube: {
    nome: "YouTube",
    Icone: IconBrandYoutubeFilled,
    cor: "#FF0033",
    fundo: "#FF0033",
    formato: "Shorts (até 3 min) ou vídeo",
    duracaoMaxS: 900,
    exigencias: [
      { chave: "Conta", valor: "Canal do YouTube", detalhe: "Você precisa ser dono ou administrador." },
      { chave: "Duração", valor: "Até 15 minutos", detalhe: "Até 3 minutos sai como Short." },
    ],
    aviso:
      "O envio pro YouTube usa um limite diário dividido entre todos os usuários. Quando ele acaba, o corte espera a próxima vaga e sai sozinho, às vezes no dia seguinte.",
  },
  threads: {
    nome: "Threads",
    Icone: IconBrandThreads,
    cor: "#111111",
    fundo: "#111111",
    formato: "post com vídeo",
    duracaoMaxS: 300,
    exigencias: [
      { chave: "Conta", valor: "Perfil do Threads" },
      { chave: "Duração", valor: "Até 5 minutos" },
      { chave: "Texto", valor: "Até 500 caracteres", detalhe: "Legenda maior é cortada." },
    ],
  },
  linkedin: {
    nome: "LinkedIn",
    Icone: IconBrandLinkedin,
    cor: "#0A66C2",
    fundo: "#0A66C2",
    formato: "post com vídeo",
    duracaoMaxS: 1800,
    exigencias: [
      { chave: "Onde publica", valor: "Perfil ou página de empresa", detalhe: "Na volta da conexão você escolhe." },
      { chave: "Duração", valor: "Até 30 minutos" },
    ],
  },
  pinterest: {
    nome: "Pinterest",
    Icone: IconBrandPinterest,
    cor: "#E60023",
    fundo: "#E60023",
    formato: "pin de vídeo",
    duracaoMaxS: 900,
    exigencias: [
      { chave: "Pasta", valor: "Obrigatória", detalhe: "Escolha em qual pasta os pins entram depois de conectar." },
      { chave: "Duração", valor: "Até 15 minutos" },
    ],
  },
  bluesky: {
    nome: "Bluesky",
    Icone: IconBrandBluesky,
    cor: "#0085FF",
    fundo: "#0085FF",
    formato: "post com vídeo",
    duracaoMaxS: 180,
    exigencias: [
      { chave: "Conexão", valor: "Senha de app", detalhe: "Crie em Configurações → Privacidade e segurança → Senhas de app." },
      { chave: "E-mail", valor: "Confirmado", detalhe: "O Bluesky só deixa publicar vídeo com o e-mail confirmado." },
      { chave: "Duração", valor: "Até 3 minutos", detalhe: "Texto até 300 caracteres." },
    ],
  },
}

export const ORDEM_DAS_REDES: Rede[] = ["tiktok", "instagram", "facebook", "youtube", "threads", "linkedin", "pinterest", "bluesky"]

/** Formata uma duração em segundos pra frase curta ("90 s", "3 min"). */
export function duracaoCurta(s: number) {
  if (s < 120) return `${s} s`
  return `${Math.round(s / 60)} min`
}
