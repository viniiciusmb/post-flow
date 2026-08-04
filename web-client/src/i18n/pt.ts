/**
 * Português — a fonte de verdade das chaves.
 *
 * `en.ts` e `es.ts` são tipados a partir daqui, então uma chave que existe aqui
 * e falta lá é erro de compilação. Ao adicionar uma chave nova, adicione nos
 * três arquivos.
 *
 * Convenção do nome: área.assunto. `{algo}` é substituído em tempo de execução.
 */
export const pt = {
  // --- comuns ---
  "comum.salvar": "Salvar",
  "comum.salvando": "Salvando...",
  "comum.salvo": "Salvo",
  "comum.cancelar": "Cancelar",
  "comum.excluir": "Excluir",
  "comum.excluindo": "Excluindo...",
  "comum.editar": "Editar",
  "comum.fechar": "Fechar",
  "comum.voltar": "Voltar",
  "comum.confirmar": "Confirmar",
  "comum.carregando": "Carregando...",
  "comum.erroGenerico": "Algo deu errado. Tente de novo.",
  "comum.nenhum": "Nenhum",
  "comum.sim": "Sim",
  "comum.nao": "Não",
  "comum.ver": "Ver",
  "comum.baixar": "Baixar",
  "comum.hoje": "Hoje",
  "comum.ontem": "Ontem",
  "comum.amanha": "Amanhã",
  "comum.agora": "Agora",
  "comum.minutos": "minutos",
  "comum.dias": "dias",

  // --- idioma e tema ---
  "tema.alternar": "Alternar tema",
  "tema.claro": "Claro",
  "tema.escuro": "Escuro",
  "tema.sistema": "Sistema",
  "idioma.escolher": "Escolher idioma",

  // --- menu ---
  "menu.inicio": "Início",
  "menu.canais": "Canais",
  "menu.cortes": "Cortes",
  "menu.publicacao": "Publicação",
  "menu.conexao": "Sua conexão",
  "menu.planoEUso": "Plano e uso",
  "menu.configuracoes": "Configurações",
  "menu.clientes": "Clientes",
  "menu.fila": "Fila de processamento",
  "menu.postagens": "Publicações",
  "menu.metricas": "Métricas",
  "menu.banda": "Consumo de banda",
  "menu.faturamento": "Faturamento",
  "menu.erros": "Erros",
  "menu.grupoOperacao": "Operação",
  "menu.grupoMeuConteudo": "Meu conteúdo",
  "menu.processamento": "Processamento",
  "menu.assinaturas": "Assinaturas",
  "menu.sair": "Sair",
  "menu.cliente": "Cliente",
  "menu.admin": "Administrador",
} as const
