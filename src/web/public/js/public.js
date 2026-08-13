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

  // Carrossel de "o que dá pra fazer": setas clicam de um cartão pro
  // próximo/anterior, os pontinhos embaixo marcam qual está mais visível
  // (calculado a partir do scroll, não de um índice fixo - o visitante pode
  // chegar lá arrastando com o dedo/mouse também, sem passar pelas setas).
  var trilho = document.getElementById('recursos-carrossel');
  if (trilho) {
    var cartoes = trilho.querySelectorAll('.recurso-card');
    var pontos = document.querySelectorAll('#recursos-pontos .recursos-ponto');
    var setaEsq = document.querySelector('.recursos-seta-esq');
    var setaDir = document.querySelector('.recursos-seta-dir');

    var passo = function () {
      return cartoes.length > 1 ? cartoes[1].offsetLeft - cartoes[0].offsetLeft : trilho.clientWidth;
    };

    var atualizar = function () {
      var indiceAtivo = Math.round(trilho.scrollLeft / passo());
      pontos.forEach(function (ponto, i) {
        ponto.classList.toggle('ativo', i === indiceAtivo);
      });
      var fimDaRolagem = trilho.scrollWidth - trilho.clientWidth - 4;
      if (setaEsq) setaEsq.disabled = trilho.scrollLeft <= 4;
      if (setaDir) setaDir.disabled = trilho.scrollLeft >= fimDaRolagem;
    };

    var pedindoQuadro = false;
    trilho.addEventListener(
      'scroll',
      function () {
        if (pedindoQuadro) return;
        pedindoQuadro = true;
        window.requestAnimationFrame(function () {
          atualizar();
          pedindoQuadro = false;
        });
      },
      { passive: true }
    );

    [setaEsq, setaDir].forEach(function (botao) {
      if (!botao) return;
      botao.addEventListener('click', function () {
        var direcao = Number(botao.dataset.direcao);
        trilho.scrollBy({ left: direcao * passo(), behavior: 'smooth' });
      });
    });

    pontos.forEach(function (ponto) {
      ponto.addEventListener('click', function () {
        trilho.scrollTo({ left: Number(ponto.dataset.indice) * passo(), behavior: 'smooth' });
      });
    });

    atualizar();
    window.addEventListener('resize', atualizar);
  }
})();
