// Modelos de estilo de corte: os prontos (definidos aqui) e os que o cliente
// salva (tabela clip_style_models).
//
// Um modelo é um conjunto PARCIAL de campos da configuração de corte. Aplicar
// é gravar esses campos por cima do que o alvo (canal, padrão ou vídeo) já
// tem - o que o modelo não traz continua como estava.
//
// Ficam FORA de qualquer modelo, de propósito:
//   - audioLanguage: o idioma é do canal (canal dublado em inglês x canal
//     brasileiro); copiar faria um canal baixar a trilha errada.
//   - descriptionMode/descriptionTemplate: a descrição fixa costuma citar o
//     canal ("Siga @fulano") - levar pra outro canal publicaria o @ errado.
//   - backgroundTemplatePath: a imagem de fundo é um arquivo enviado PARA
//     aquele alvo; o caminho não pode ser copiado de um lugar pro outro.
'use strict';

// Tudo que um modelo do cliente leva (estilo visual + como cortar).
const CAMPOS_DO_MODELO = [
  'captionStyle',
  'captionFont',
  'titleBoxColor',
  'captionBoxColor',
  'titleFont',
  'captionHeightPercent',
  'titleHeightPercent',
  'clipLength',
  'clipMode',
  'fullPartsMode',
  'fullPartsMinutes',
  'fullPartsCount',
  'maxClips',
  'showTitle',
  'titleSeconds',
  'cropStyleMode',
  'cropZoomPercent',
  'showPartLabel',
  'partLabelPosition',
  'partLabelSizePercent',
  'titleStyle',
  'backgroundStyle',
  'backgroundVideoHeightPercent',
  'backgroundVideoOffsetPercent',
  'thumbnailPosition',
];

// Visual comum a todos os prontos: modo Manual (é nele que a legenda e o
// título escolhidos aparecem no editor) e vídeo inteiro na tela.
const BASE_VISUAL = {
  cropStyleMode: 'manual',
  cropZoomPercent: 100,
  backgroundVideoHeightPercent: 100,
  backgroundVideoOffsetPercent: 50,
  showTitle: true,
  titleSeconds: 3,
  captionHeightPercent: 14,
  titleHeightPercent: 8,
};

// Os prontos mudam só a APARÊNCIA (o "Série em partes" é a exceção, porque o
// jeito de cortar É o estilo dele). Escolher um modelo pela cara não pode
// mudar quantos cortes o cliente pediu.
const PADROES = [
  {
    chave: 'classico',
    nome: 'Clássico',
    descricao: 'Legenda branca com contorno e título vermelho. Funciona em qualquer canal.',
    campos: { ...BASE_VISUAL, captionStyle: 'classic', titleStyle: 'classic', captionFont: 'Anton', titleFont: 'Anton', titleBoxColor: '#D92323', captionBoxColor: '#D92323', backgroundStyle: 'blur', showPartLabel: false },
  },
  {
    chave: 'viral',
    nome: 'Viral amarelo',
    descricao: 'Legenda grande em amarelo e título com a palavra-chave destacada.',
    campos: { ...BASE_VISUAL, captionStyle: 'maiusculo_amarelo', titleStyle: 'destaque_amarelo', captionFont: 'Anton', titleFont: 'Anton', backgroundStyle: 'blur', showPartLabel: false },
  },
  {
    chave: 'podcast',
    nome: 'Podcast',
    descricao: 'Fundo preto, título em faixa e legenda em caixa. Bom pra entrevista e conversa.',
    campos: { ...BASE_VISUAL, captionStyle: 'amarelo_caixa', titleStyle: 'faixa_preta', captionFont: 'Poppins', titleFont: 'Poppins', backgroundStyle: 'black', showPartLabel: false },
  },
  {
    chave: 'minimalista',
    nome: 'Minimalista',
    descricao: 'Letra limpa, sem caixa, sobre fundo desfocado. Pra canal de estilo e lifestyle.',
    campos: { ...BASE_VISUAL, captionStyle: 'simples', titleStyle: 'simples', captionFont: 'Poppins', titleFont: 'Poppins', backgroundStyle: 'blur', showPartLabel: false },
  },
  {
    chave: 'neon',
    nome: 'Neon',
    descricao: 'Brilho azul na legenda e rosa no título, sobre fundo preto. Pra games e tecnologia.',
    campos: { ...BASE_VISUAL, captionStyle: 'brilho_azul', titleStyle: 'brilho_rosa', captionFont: 'Bebas Neue', titleFont: 'Bebas Neue', backgroundStyle: 'black', showPartLabel: false },
  },
  {
    chave: 'serie',
    nome: 'Série em partes',
    descricao: 'Corta o vídeo inteiro em partes de ~3 min, numeradas "Parte 1, 2, 3...".',
    campos: {
      ...BASE_VISUAL,
      captionStyle: 'contorno_grosso',
      titleStyle: 'faixa_colorida',
      captionFont: 'Anton',
      titleFont: 'Anton',
      titleBoxColor: '#2F54EB',
      backgroundStyle: 'blur',
      clipMode: 'full_parts',
      fullPartsMode: 'duration',
      fullPartsMinutes: 3,
      showPartLabel: true,
      partLabelPosition: 'top_right',
      partLabelSizePercent: 100,
    },
  },
];

function padraoPorChave(chave) {
  return PADROES.find((p) => p.chave === chave) || null;
}

// Pega só os campos de modelo de uma configuração no formato da API (camelCase).
function extrairCampos(configuracao) {
  const saida = {};
  for (const campo of CAMPOS_DO_MODELO) {
    if (configuracao[campo] !== undefined) saida[campo] = configuracao[campo];
  }
  return saida;
}

module.exports = { CAMPOS_DO_MODELO, PADROES, padraoPorChave, extrairCampos };
