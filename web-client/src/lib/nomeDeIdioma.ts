/**
 * Nome de um idioma, escrito no idioma de quem está lendo a tela.
 *
 * Usa o `Intl.DisplayNames` do próprio navegador em vez de uma lista escrita à
 * mão. Não é economia de digitação: uma lista nossa teria que ter os nomes de
 * cada idioma nas TRÊS línguas do painel (português, inglês e espanhol), e
 * ficaria incompleta no dia em que um canal dublasse em sueco — que é um caso
 * real, porque o seletor oferece o que o VÍDEO tem, não o que previmos.
 *
 * Quem não conhece o código (ou navegador sem suporte) recebe o código em
 * maiúsculas, que ainda é legível: "SV" diz mais que um espaço em branco.
 */
export function nomeDeIdioma(codigo: string, idiomaDoPainel: string): string {
  if (!codigo) return ""
  try {
    const nome = new Intl.DisplayNames([idiomaDoPainel], { type: "language" }).of(codigo)
    if (!nome || nome === codigo) return codigo.toUpperCase()
    // O Intl devolve em minúscula em várias línguas ("português", "español").
    // Numa lista de opções, a maiúscula inicial é o que faz parecer um nome.
    return nome.charAt(0).toUpperCase() + nome.slice(1)
  } catch {
    return codigo.toUpperCase()
  }
}
