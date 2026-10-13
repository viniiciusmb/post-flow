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

  var semMovimento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Landing: as seções entram ao chegar na tela. A classe lp-js no <html> é o
  // que liga o "esconder antes de entrar" no CSS - sem script, nada fica
  // escondido. O que já está na tela na abertura aparece na hora, sem piscar.
  var revelaveis = document.querySelectorAll('[data-revelar]');
  if (revelaveis.length && !semMovimento && 'IntersectionObserver' in window) {
    var revelar = function (el) {
      el.classList.add('lp-revelado');
    };
    var alturaTela = window.innerHeight || document.documentElement.clientHeight;
    revelaveis.forEach(function (el) {
      if (el.getBoundingClientRect().top < alturaTela * 0.92) revelar(el);
    });
    document.documentElement.classList.add('lp-js');
    var observadorRevelar = new IntersectionObserver(
      function (entradas) {
        entradas.forEach(function (entrada) {
          if (!entrada.isIntersecting) return;
          revelar(entrada.target);
          observadorRevelar.unobserve(entrada.target);
        });
      },
      { rootMargin: '0px 0px -8% 0px' }
    );
    revelaveis.forEach(function (el) {
      if (!el.classList.contains('lp-revelado')) observadorRevelar.observe(el);
    });
  }

  // Landing: a rede no fim do título troca sozinha (TikTok, Instagram,
  // YouTube Shorts...). O título completo, com todas, está escrito para leitor
  // de tela num <span class="sr-only">; este é só o desenho.
  var rotativo = document.querySelector('[data-rotativo]');
  if (rotativo && !semMovimento) {
    var palavras = rotativo.getAttribute('data-rotativo').split('|');
    var atual = 0;
    setInterval(function () {
      if (document.hidden) return;
      rotativo.classList.add('saindo');
      setTimeout(function () {
        atual = (atual + 1) % palavras.length;
        rotativo.textContent = palavras[atual];
        rotativo.classList.remove('saindo');
        rotativo.classList.add('entrando');
        // Força o navegador a desenhar o estado de entrada antes de tirar a
        // classe, senão a transição não acontece.
        void rotativo.offsetWidth;
        rotativo.classList.remove('entrando');
      }, 350);
    }, 2400);
  }
})();
