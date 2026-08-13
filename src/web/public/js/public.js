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

  // Vídeos abaixo da dobra (marcados com data-lazy-src) só baixam quando
  // chegam perto da tela - sem isso o navegador competia a banda deles com o
  // vídeo da hero logo na abertura da página, mesmo quem nunca rola até lá
  // pagando o download inteiro à toa.
  var videosPreguicosos = document.querySelectorAll('video[data-lazy-src]');
  if (videosPreguicosos.length && 'IntersectionObserver' in window) {
    var observador = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (entrada) {
          if (!entrada.isIntersecting) return;
          var video = entrada.target;
          video.src = video.dataset.lazySrc;
          video.play().catch(function () {
            // Autoplay recusado (raro, com muted já ligado) - o poster
            // continua visível, sem erro nenhum pro visitante.
          });
          observador.unobserve(video);
        });
      },
      { rootMargin: '400px 0px' }
    );
    videosPreguicosos.forEach(function (video) {
      observador.observe(video);
    });
  } else {
    // Navegador sem IntersectionObserver (bem raro hoje): carrega direto, é
    // melhor que o vídeo nunca aparecer.
    videosPreguicosos.forEach(function (video) {
      video.src = video.dataset.lazySrc;
    });
  }
})();
