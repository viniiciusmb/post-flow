/**
 * Texto traduzido que contém formatação.
 *
 * As páginas de instrução (como a de Sua conexão) têm negrito e trechos em
 * fonte de código no meio das frases. Quebrar cada frase em pedaços pra montar
 * o JSX deixaria o dicionário ilegível — e impossível de revisar por quem
 * traduz, que veria fragmentos soltos em vez de frases.
 *
 * O HTML aqui vem SEMPRE do nosso próprio dicionário, nunca de dado digitado
 * por alguém. É por isso que inserir direto é seguro neste caso e não seria em
 * nenhum lugar que mostre conteúdo de cliente.
 */
export function Rico({ html, className }: { html: string; className?: string }) {
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
