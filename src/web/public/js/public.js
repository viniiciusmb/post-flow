// Comportamentos das páginas públicas.
//
// Fica num ARQUIVO, não inline no HTML: a política de segurança do site é
// `script-src 'self'`, que bloqueia <script> escrito dentro da página. Isso foi
// descoberto ao ligar o seletor de idioma - e revelou que o efeito da barra do
// topo, escrito inline, nunca tinha funcionado desde que o cabeçalho de
// segurança entrou. Um script inline não dá erro visível: ele simplesmente não
// executa.
(function () {
  'use strict';

  // A barra do topo só ganha a linha divisória depois que a página rola.
  // Parada no topo ela fica sem moldura, colada no fundo branco.
  var barra = document.getElementById('topbar');
  if (barra) {
    var marcar = function () {
      barra.classList.toggle('rolou', window.scrollY > 8);
    };
    marcar();
    window.addEventListener('scroll', marcar, { passive: true });
  }

  // Troca de idioma: grava o cookie (que o servidor lê pra montar a página) e
  // recarrega. O localStorage também é atualizado porque é de lá que o painel
  // React lê o idioma, e os dois têm que concordar - senão o site público e o
  // painel abririam em idiomas diferentes.
  var seletor = document.getElementById('seletor-idioma');
  if (seletor) {
    seletor.addEventListener('change', function () {
      document.cookie = 'lang=' + seletor.value + '; path=/; max-age=31536000; samesite=lax';
      try {
        localStorage.setItem('lang', seletor.value);
      } catch (e) {
        // Navegador com armazenamento bloqueado: o cookie sozinho já resolve
        // as páginas públicas.
      }
      window.location.reload();
    });
  }
})();
