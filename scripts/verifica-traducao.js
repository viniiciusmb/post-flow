// Acha texto em portugues que sobrou na interface, com o site em ingles.
//
// COMO USAR
//   1. suba o servidor local na porta 3099 (ver CLAUDE.md, "Como testar")
//   2. node scripts/verifica-traducao.js
//
// POR QUE ELE EXISTE
// Tentei tres varreduras no codigo-fonte antes desta, e cada uma deixou passar
// um caso que a seguinte pegou:
//   - a primeira procurava frase, e deixou passar rotulo curto ("Cortar");
//   - a segunda olhava texto entre tags, e deixou passar string dentro de
//     expressao ({cond ? "Pausar" : "Retomar"});
//   - a terceira olhava string literal, e deixou passar frase quebrada por um
//     link no meio ("Conecte seu <a>Google Drive</a> em Configuracoes"), porque
//     cada pedaco sozinho nao parece portugues.
//
// Esta le a PAGINA RENDERIZADA, no de texto por no de texto. E a unica versao
// que nao tem como errar por causa de como o codigo foi escrito - o que chega
// na tela e exatamente o que ela mede.
//
// O que sobra legitimamente e conteudo do banco (titulo de video, nome de
// canal, nome de arquivo). Marque esses elementos com data-conteudo e eles
// param de aparecer aqui.
const { chromium } = require('playwright-core');

const PT = /[ãõç]|\b(você|vocês|vídeos?|cortes?|canais|nenhum\w*|postagem|postar|salvar|salvando|configurações|publicação|senha|clientes?|período|seguidores|curtidas|adicionar|pausar|trocar|conectad\w|conecte|conectar|remover|excluir|enviar|baixar|processar|retomar|cortar|escolher|mostrar|ocultar|habilitar|pra|para\s+essa|não|sim)\b/i;

const TELAS_CLIENTE = [
  ['inicio','/client'],['canais','/client/youtube-channels'],['cortes','/client/videos-clips'],
  ['publicacao','/client/tiktok-account'],['conexao','/client/tunnel'],['plano','/client/billing'],
  ['config','/client/settings'],
];
const TELAS_ADMIN = [
  ['adm-inicio','/admin'],['adm-clientes','/admin/clients'],['adm-publicacoes','/admin/postings'],
  ['adm-fila','/admin/queue'],['adm-metricas','/admin/metrics'],['adm-banda','/admin/bandwidth'],
  ['adm-assinaturas','/admin/billing'],['adm-erros','/admin/errors'],
];

(async () => {
  const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  let total = 0;

  for (const [email, telas] of [['demo@postflow.com', TELAS_CLIENTE], ['admin@postflow.com', TELAS_ADMIN]]) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 1100 } });
    await ctx.addCookies([{ name: 'lang', value: 'en', domain: 'localhost', path: '/' }]);
    const p = await ctx.newPage();
    await p.goto('http://localhost:3099/login');
    await p.evaluate(async (e) => {
      localStorage.setItem('lang', 'en');
      const c = document.cookie.match(/csrf_token=([^;]*)/);
      await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': c ? decodeURIComponent(c[1]) : '' }, body: JSON.stringify({ email: e, password: 'senha-forte-9090' }) });
    }, email);

    for (const [nome, url] of telas) {
      await p.goto('http://localhost:3099' + url);
      await p.waitForTimeout(2200);
      const sobras = await p.evaluate((re) => {
        const rx = new RegExp(re, 'i');
        const achados = new Set();
        const andador = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let no;
        while ((no = andador.nextNode())) {
          const pai = no.parentElement;
          if (!pai || pai.closest('script, style')) continue;
          // conteudo do banco (titulo de video, nome de canal) nao e interface
          if (pai.closest('[data-conteudo]')) continue;
          const t = (no.textContent || '').trim();
          if (t.length > 2 && rx.test(t)) achados.add(t.slice(0, 60));
        }
        return [...achados];
      }, PT.source);
      if (sobras.length) {
        total += sobras.length;
        console.log(`  ${nome}:`);
        sobras.forEach((s) => console.log(`     ${s}`));
      }
    }
    await ctx.close();
  }
  console.log(total === 0 ? '\nnenhuma sobra de portugues na interface' : `\n${total} sobras`);
  await b.close();
})();
