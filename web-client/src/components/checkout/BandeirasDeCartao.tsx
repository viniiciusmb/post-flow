/*
 * Bandeiras de cartão: reconhecimento pelo início do número e as marcas
 * desenhadas.
 *
 * Duas decisões que explicam o arquivo:
 *
 *   1. A ORDEM DA DETECÇÃO IMPORTA. Elo e Hipercard são brasileiras e ocupam
 *      faixas que, olhadas só pelo primeiro dígito, parecem Visa, Mastercard ou
 *      Discover. Testar Visa primeiro faria todo cartão Elo aparecer como Visa
 *      na tela — erro que só o cliente brasileiro vê, e logo antes de digitar o
 *      número do cartão dele. Por isso as faixas específicas vêm primeiro e as
 *      genéricas por último.
 *
 *   2. ISTO É SÓ PARA A TELA. Quem decide de verdade qual é a bandeira é o
 *      Asaas, na tokenização. Errar aqui não muda nenhuma cobrança — muda só o
 *      desenho ao lado do campo. Por isso o desconhecido não vira erro: ele
 *      simplesmente não mostra bandeira nenhuma.
 */

export type BandeiraId =
  | "visa"
  | "mastercard"
  | "elo"
  | "amex"
  | "hipercard"
  | "diners"
  | "discover"
  | "jcb"

function apenasDigitos(v: string) {
  return v.replace(/\D/g, "")
}

// Um prefixo numérico cai dentro da faixa? Compara pelos primeiros N dígitos,
// onde N é o tamanho dos limites — é assim que faixa de BIN funciona.
function naFaixa(digitos: string, de: number, ate: number) {
  const tamanho = String(ate).length
  if (digitos.length < tamanho) return false
  const inicio = Number(digitos.slice(0, tamanho))
  return inicio >= de && inicio <= ate
}

function comecaCom(digitos: string, prefixos: string[]) {
  return prefixos.some((p) => digitos.startsWith(p))
}

// Faixas do Elo, que são muitas e específicas. Sem esta lista o Elo seria
// confundido com Visa (4xx), Mastercard (5xx) e Discover (6xx).
function ehElo(d: string) {
  if (
    comecaCom(d, [
      "401178", "401179", "431274", "438935", "451416", "457393", "457631", "457632",
      "504175", "627780", "636297", "636368", "651652",
    ])
  ) {
    return true
  }
  return (
    naFaixa(d, 506699, 506778) ||
    naFaixa(d, 509000, 509999) ||
    naFaixa(d, 650031, 650033) ||
    naFaixa(d, 650035, 650051) ||
    naFaixa(d, 650405, 650439) ||
    naFaixa(d, 650485, 650538) ||
    naFaixa(d, 650541, 650598) ||
    naFaixa(d, 650700, 650718) ||
    naFaixa(d, 650720, 650727) ||
    naFaixa(d, 650901, 650978) ||
    naFaixa(d, 651652, 651679) ||
    naFaixa(d, 655000, 655019) ||
    naFaixa(d, 655021, 655058)
  )
}

export function detectarBandeira(numero: string): BandeiraId | null {
  const d = apenasDigitos(numero)
  if (d.length < 2) return null

  // As brasileiras primeiro: elas moram dentro das faixas das internacionais.
  if (ehElo(d)) return "elo"
  if (comecaCom(d, ["606282", "3841"])) return "hipercard"

  if (comecaCom(d, ["34", "37"])) return "amex"
  if (comecaCom(d, ["36", "38"]) || naFaixa(d, 300, 305) || comecaCom(d, ["3095"])) return "diners"
  if (naFaixa(d, 3528, 3589)) return "jcb"
  if (comecaCom(d, ["6011", "65"]) || naFaixa(d, 644, 649) || naFaixa(d, 622126, 622925)) return "discover"

  if (d.startsWith("4")) return "visa"
  if (naFaixa(d, 51, 55) || naFaixa(d, 2221, 2720)) return "mastercard"

  return null
}

// Luhn. Pega o erro de digitação mais comum (um dígito trocado) ANTES de mandar
// o cartão para o Asaas — o que evita uma recusa vinda da API no meio do
// pagamento, que na tela parece "meu cartão foi negado" quando na verdade foi
// erro de digitação.
export function passaNoLuhn(numero: string) {
  const d = apenasDigitos(numero)
  if (d.length < 12) return false
  let soma = 0
  let dobra = false
  for (let i = d.length - 1; i >= 0; i -= 1) {
    let n = Number(d[i])
    if (dobra) {
      n *= 2
      if (n > 9) n -= 9
    }
    soma += n
    dobra = !dobra
  }
  return soma % 10 === 0
}

// O Asaas devolve a bandeira em caixa alta ("MASTERCARD"). Mostrar isso cru na
// tela fica gritado e denuncia dado repassado sem cuidado - aqui ele vira a
// marca desenhada e o nome escrito como se escreve.
export function bandeiraDoAsaas(marca: string | null | undefined): BandeiraId | null {
  const chave = String(marca || "").trim().toLowerCase()
  if (!chave) return null
  if (chave === "amex" || chave.includes("american")) return "amex"
  if (chave.includes("master")) return "mastercard"
  if (chave.includes("visa")) return "visa"
  if (chave.includes("elo")) return "elo"
  if (chave.includes("hiper")) return "hipercard"
  if (chave.includes("diners")) return "diners"
  if (chave.includes("discover")) return "discover"
  if (chave.includes("jcb")) return "jcb"
  return null
}

export const NOME_DA_BANDEIRA: Record<BandeiraId, string> = {
  visa: "Visa",
  mastercard: "Mastercard",
  elo: "Elo",
  amex: "American Express",
  hipercard: "Hipercard",
  diners: "Diners Club",
  discover: "Discover",
  jcb: "JCB",
}

/*
 * As marcas.
 *
 * São desenhos próprios, simples e reconhecíveis — não os logotipos oficiais.
 * Motivo prático: logotipo de bandeira é material de marca de terceiro, com
 * regras de uso próprias, e embutir arquivos de imagem obrigaria a carregá-los
 * de algum lugar. Em SVG inline eles seguem o tema, não pesam nada e nunca
 * ficam quebrados por um arquivo que não carregou.
 */
function Moldura({ children, titulo }: { children: React.ReactNode; titulo: string }) {
  return (
    <svg viewBox="0 0 40 26" role="img" aria-label={titulo} className="h-[26px] w-10 shrink-0">
      <title>{titulo}</title>
      <rect x="0.5" y="0.5" width="39" height="25" rx="4" fill="#fff" stroke="#dcdce2" />
      {children}
    </svg>
  )
}

const DESENHOS: Record<BandeiraId, React.ReactNode> = {
  visa: (
    <text x="20" y="17.5" textAnchor="middle" fontSize="10.5" fontWeight="700" fontStyle="italic" fill="#1a1f71" fontFamily="Helvetica, Arial, sans-serif">
      VISA
    </text>
  ),
  mastercard: (
    <>
      <circle cx="16.5" cy="13" r="7" fill="#eb001b" />
      <circle cx="23.5" cy="13" r="7" fill="#f79e1b" />
      <path d="M20 7.9a7 7 0 0 0 0 10.2 7 7 0 0 0 0-10.2Z" fill="#ff5f00" />
    </>
  ),
  elo: (
    <>
      <circle cx="13.5" cy="13" r="4.2" fill="#ffcb05" />
      <circle cx="20" cy="13" r="4.2" fill="#00a4e0" />
      <circle cx="26.5" cy="13" r="4.2" fill="#ef4123" />
    </>
  ),
  amex: (
    <>
      <rect x="4" y="5" width="32" height="16" rx="2.5" fill="#2e77bc" />
      <text x="20" y="16.3" textAnchor="middle" fontSize="7.5" fontWeight="700" fill="#fff" fontFamily="Helvetica, Arial, sans-serif">
        AMEX
      </text>
    </>
  ),
  hipercard: (
    <>
      <rect x="4" y="5" width="32" height="16" rx="2.5" fill="#b3131b" />
      <text x="20" y="16" textAnchor="middle" fontSize="6.2" fontWeight="700" fill="#fff" fontFamily="Helvetica, Arial, sans-serif">
        HIPER
      </text>
    </>
  ),
  diners: (
    <>
      <circle cx="20" cy="13" r="7.5" fill="#0079be" />
      <circle cx="20" cy="13" r="4" fill="#fff" />
    </>
  ),
  discover: (
    <>
      <rect x="4" y="5" width="32" height="16" rx="2.5" fill="#f2f2f4" />
      <circle cx="27" cy="13" r="4.6" fill="#f68121" />
      <text x="15" y="15.6" textAnchor="middle" fontSize="5.6" fontWeight="700" fill="#1c1c1c" fontFamily="Helvetica, Arial, sans-serif">
        DISC
      </text>
    </>
  ),
  jcb: (
    <>
      <rect x="7" y="6" width="8" height="14" rx="1.6" fill="#0e4c96" />
      <rect x="16" y="6" width="8" height="14" rx="1.6" fill="#c9152b" />
      <rect x="25" y="6" width="8" height="14" rx="1.6" fill="#00a650" />
    </>
  ),
}

export function Bandeira({ id, className = "" }: { id: BandeiraId; className?: string }) {
  return (
    <span className={className}>
      <Moldura titulo={NOME_DA_BANDEIRA[id]}>{DESENHOS[id]}</Moldura>
    </span>
  )
}

// A ordem em que aparecem embaixo do campo: as mais usadas no Brasil primeiro.
export const BANDEIRAS_ACEITAS: BandeiraId[] = [
  "visa",
  "mastercard",
  "elo",
  "amex",
  "hipercard",
  "diners",
  "discover",
  "jcb",
]

// A fileira de bandeiras aceitas. Enquanto o cliente não digitou nada, todas
// aparecem normalmente; assim que o número identifica uma, as outras apagam —
// isso confirma na hora que o cartão dele é aceito, que é a dúvida real de
// quem está com o cartão na mão.
export function FileiraDeBandeiras({ detectada }: { detectada: BandeiraId | null }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {BANDEIRAS_ACEITAS.map((id) => (
        <Bandeira
          key={id}
          id={id}
          className={
            detectada && detectada !== id
              ? "opacity-25 grayscale transition-all duration-200"
              : "transition-all duration-200"
          }
        />
      ))}
    </div>
  )
}
