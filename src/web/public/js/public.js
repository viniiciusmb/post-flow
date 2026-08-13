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

  // Cartão "ao vivo" da hero: simula uma conta crescendo DO ZERO com o
  // Post Flow - os números sobem junto (curva de desaceleração, como
  // crescimento de conta de verdade) até um alvo, e o ciclo inteiro
  // recomeça em loop (com uma pausa curta e um fade pra não ficar um corte
  // seco de volta pro zero). Formata em K/M pra não amontoar dígito demais
  // num cartão pequeno. Quem prefere menos movimento na tela
  // (prefers-reduced-motion) recebe os números já "crescidos", parados -
  // contagem em loop contínuo é exatamente o tipo de movimento que essa
  // preferência pede pra evitar.
  var provaCartao = document.querySelector('.hero-prova');
  if (provaCartao) {
    var elSeguidores = provaCartao.querySelector('[data-prova-seguidores]');
    var elVideos = provaCartao.querySelector('[data-prova-videos]');
    var elViews = provaCartao.querySelector('[data-prova-views]');
    var elStats = provaCartao.querySelector('.hero-prova-stats');

    // K/M em vez de "mil"/"mi": esse cartão é o mesmo em português, inglês e
    // espanhol (não tem tradução própria, só os rótulos ao redor vêm de
    // i18n), e K/M já é como o TikTok/Instagram mostram contador em
    // qualquer idioma - não precisa de lógica de localização própria aqui.
    var formatar = function (n) {
      if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
      if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
      return String(n);
    };

    var pulsar = function (el) {
      el.classList.remove('hero-prova-subiu');
      // Força reflow pra reiniciar a transição mesmo se ainda estava com a
      // classe (atualizações muito próximas uma da outra).
      void el.offsetWidth;
      el.classList.add('hero-prova-subiu');
    };

    // Só troca o texto (e pulsa) quando o valor FORMATADO muda de verdade -
    // o valor bruto muda a cada quadro, mas arredondado/abreviado (K/M) boa
    // parte dos quadros não move o dígito exibido.
    var escreverSe = function (el, texto) {
      if (el.textContent !== texto) {
        el.textContent = texto;
        pulsar(el);
      }
    };

    var ALVO = { seguidores: 14800, videos: 96, views: 1950000 };
    var DURACAO_MS = 24000;
    var PAUSA_MS = 900;

    var semMovimento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (semMovimento) {
      elSeguidores.textContent = formatar(ALVO.seguidores);
      elVideos.textContent = formatar(ALVO.videos);
      elViews.textContent = formatar(ALVO.views);
    } else {
      var inicio = Date.now();
      var quadro = function () {
        var decorrido = Date.now() - inicio;
        if (decorrido >= DURACAO_MS) {
          // Fade rápido, zera os três, espera um instante e recomeça o
          // ciclo - deixa claro que é um "replay" da simulação, não um
          // corte seco de volta pro zero.
          elStats.style.opacity = '0';
          setTimeout(function () {
            elSeguidores.textContent = '0';
            elVideos.textContent = '0';
            elViews.textContent = '0';
            elStats.style.opacity = '1';
            inicio = Date.now();
          }, 450);
          setTimeout(quadro, PAUSA_MS);
          return;
        }
        var t = decorrido / DURACAO_MS;
        var suave = 1 - Math.pow(1 - t, 2); // ease-out: rápido no começo, desacelera no fim
        escreverSe(elSeguidores, formatar(Math.round(ALVO.seguidores * suave)));
        escreverSe(elVideos, formatar(Math.round(ALVO.videos * suave)));
        escreverSe(elViews, formatar(Math.round(ALVO.views * suave)));
        setTimeout(quadro, 150);
      };
      quadro();
    }
  }
})();
