'use strict';

// Español. Las claves reflejan pt.js; si falta una, cae al portugués.

const { CONTACT } = require('../config/constants');
const legal = require('./legal-es');

module.exports = {
  nav: {
    comoFunciona: 'Cómo funciona',
    recursos: 'Funciones',
    planos: 'Planes',
    duvidas: 'Preguntas',
    entrar: 'Entrar',
    criarConta: 'Crear cuenta',
    meuPainel: 'Mi panel',
    inicio: 'Post Flow, página de inicio',
    idioma: 'Idioma',
  },

  rodape: {
    descricao: 'Clips automáticos de tu canal de YouTube publicados en tu TikTok.',
    produto: 'Producto',
    empresa: 'Empresa',
    legal: 'Legal',
    contato: 'Contacto',
    termos: 'Términos de Uso',
    privacidade: 'Política de Privacidad',
    direitos: 'Todos los derechos reservados.',
    naoAfiliado:
      'Post Flow no está afiliado a YouTube, TikTok ni Google. Todas las marcas pertenecen a sus dueños.',
  },

  landing: {
    tituloPagina: 'Clips automáticos de YouTube para TikTok',
    metaDescricao:
      'Post Flow sigue tu canal de YouTube, corta los mejores fragmentos con IA y los publica en tu TikTok automáticamente.',

    selo: '100% automático',
    h1a: 'Grabas una vez.',
    h1b: 'El resto pasa',
    h1c: 'solo',
    lead:
      'Publicas en YouTube y Post Flow lo detecta al instante. Descarga el vídeo, la IA lee la transcripción entera y elige los mejores fragmentos, los corta en vertical con subtítulos incrustados y los publica en tu TikTok.',
    leadForte: 'Sin abrir un editor, sin abrir TikTok.',
    verComoFunciona: 'Ver cómo funciona',
    notaHero:
      'Hecho para quien ya produce su propio contenido y quiere dejar de editar clips a mano.',
    altComputador:
      'La pantalla de clips de Post Flow en el ordenador, con los vídeos del canal en distintas etapas del procesamiento',
    altCelular: 'La misma pantalla de clips abierta en el móvil',
    tutorialVideoAlt:
      'Vídeo tutorial con capturas reales de la plataforma: paso 1, agregar el canal de YouTube; paso 2, configurar el estilo de corte; paso 3, conectar la cuenta de TikTok.',
    telasOlho: 'Donde lo usas',
    telasTitulo: 'Disponible en computadora y celular',
    telasTexto:
      'El panel funciona completo en los dos — revisa tus clips desde la computadora en la oficina o desde el celular en cualquier lugar.',

    whatsOlho: 'Comunidad',
    whatsTitulo: 'Hay un grupo de WhatsApp solo para quienes usan Post Flow',
    whatsTexto:
      'Resuelve dudas, intercambia ideas con otros creadores y entérate primero de las novedades. Gratis, sin vueltas.',
    whatsBotao: 'Entrar al grupo',
    whatsBannerTexto: 'Grupo Post Flow',

    fluxoVideoAlt:
      'Vídeo mostrando el flujo automático: un vídeo nuevo publicado en YouTube, Post Flow cortándolo en clips verticales, y la publicación automática en TikTok.',
    fluxo: [
      {
        h: 'Publicas en YouTube',
        p: 'Un vídeo largo: pódcast, directo, clase, entrevista. Como ya lo haces hoy.',
      },
      {
        h: 'Post Flow hace el trabajo',
        p: 'Detecta, transcribe, elige los fragmentos, corta en vertical y subtitula. Sin que nadie haga clic en nada.',
      },
      {
        h: 'Sale en tu TikTok',
        p: 'Publicado directamente en tu perfil, a la hora que elegiste. Tú solo lo sigues.',
      },
    ],

    comoFuncionaTitulo: 'Cuatro etapas. Participas en la primera.',
    passos: [
      {
        h: 'Conecta el canal',
        p: 'Pega la dirección de tu canal de YouTube. A partir de ahí Post Flow detecta solo cuándo publicas un vídeo nuevo. También puedes subir un archivo del ordenador o pegar el enlace de un vídeo concreto.',
      },
      {
        h: 'La IA elige los fragmentos',
        p: 'El audio se transcribe y una inteligencia artificial lee la transcripción entera buscando los fragmentos que funcionan solos: inicio, gancho y cierre. Tú decides entre los mejores momentos, el vídeo entero o una cantidad fija de clips.',
      },
      {
        h: 'Corte, subtítulos y portada',
        p: 'Cada fragmento se convierte en un vídeo vertical 9:16 con subtítulos incrustados, título opcional y portada. En modo manual ajustas el encuadre arrastrando y eliges el estilo en una galería visual.',
      },
      {
        h: 'Publicación a tu horario',
        p: 'Los clips terminados entran en una cola con texto editable. Tú defines las horas del día, o dejas que el sistema las reparta solo, y publica. Si prefieres revisar antes, envía todo a una carpeta de tu Google Drive.',
      },
    ],

    recursosOlho: 'Lo que puedes hacer',
    recursosTitulo: 'Tú mandas en el resultado, sin abrir un editor',
    recursosTexto:
      'El clip automático sale listo para publicar. Pero si tienes una forma propia de presentar, puedes ajustar cada parte.',
    recursos: [
      {
        h: 'Estilo visual del clip',
        p: 'Elige el estilo de los subtítulos en una galería: clásico, en negrita, discreto o en globo de color. Lo mismo vale para el título que aparece en los primeros segundos.',
      },
      {
        h: 'Encuadre a mano',
        p: 'En modo manual arrastras el vídeo dentro del marco vertical y decides cuánto acercar. Lo que ves en la pantalla es exactamente lo que sale en el clip.',
      },
      {
        h: 'Imagen de fondo',
        p: 'Sube una plantilla de fondo con tu marca y coloca el vídeo encima. Todos los clips de ese canal salen con la misma identidad.',
      },
      {
        h: 'Numeración de serie',
        p: 'Activa el sello "Parte 1, Parte 2" y elige en qué esquina de la pantalla aparece. Sirve para convertir un vídeo largo en una secuencia que engancha.',
      },
      {
        h: 'Configuración por canal',
        p: 'Cada canal puede tener su propio estilo, o defines un valor por defecto y lo aplicas a todos de una vez. La cantidad de clips, la duración y la calidad también.',
      },
      {
        h: 'Descripción automática',
        p: 'El texto de cada clip lo escribe la IA a partir de lo que se dijo en el fragmento. Puedes editarlo antes de publicar, o fijar un texto propio.',
      },
      {
        h: 'Un canal, varias cuentas',
        p: 'Varios canales de YouTube y varias cuentas de TikTok a la vez. Cada canal publica en la cuenta que le vinculaste.',
      },
      {
        h: 'Horarios que tú eliges',
        p: 'Define las horas fijas del día o deja que el sistema las reparta solo. La cola muestra cuándo va a salir cada clip.',
      },
      {
        h: 'Copia en Google Drive',
        p: 'Si prefieres revisar antes, cada clip terminado puede ir automáticamente a una carpeta de tu Drive, separada por canal.',
      },
    ],

    planosOlho: 'Planes',
    planosTitulo: 'Pagas por minuto de vídeo procesado',
    planosTexto:
      'Los minutos se renuevan cada semana. Cuando las descargas salen por tu propia conexión a internet, nuestro coste baja, y ese ahorro vuelve a ti en forma de minutos bonus.',
    maisEscolhido: 'El más elegido',
    porMes: '/mes',
    minutosPorSemana: '{n} minutos',
    minutosPorSemanaResto: 'de vídeo por semana',
    minutosBonus: '{n} minutos',
    minutosBonusResto: 'usando tu internet',
    canaisYoutube: '{n} canales de YouTube',
    canalYoutube: '{n} canal de YouTube',
    canaisIlimitados: 'Canales de YouTube ilimitados',
    contasTiktok: '{n} cuentas de TikTok',
    contaTiktok: '{n} cuenta de TikTok',
    contasIlimitadas: 'Cuentas de TikTok ilimitadas',
    incluiCorte: 'Corte con IA, subtítulos, portada y programación',
    incluiDrive: 'Exportación a Google Drive',
    comecar: 'Empezar',
    notaPlanos:
      '¿Se acabaron los minutos de la semana? Puedes comprar un paquete suelto, que no caduca. No se cobra nada más allá de la suscripción sin que lo autorices.',

    faqOlho: 'Preguntas frecuentes',
    faqTitulo: 'Lo que suelen preguntar',
    faqRodapeA: '¿Te quedó alguna duda? Escribe a',
    faqRodapeB: 'respondemos',

    finalOlho: 'Empieza hoy',
    finalTitulo: 'Pega el enlace de tu canal y mira salir el primer clip',
    finalTexto:
      'La configuración lleva unos minutos. Después de eso, cada vídeo nuevo de tu canal se convierte en un clip publicado sin que toques nada.',
    falarComAGente: 'Hablar con nosotros',
    semFidelidade: 'Sin permanencia. Cancela cuando quieras.',
  },

  perguntas: [
    {
      p: '¿Post Flow publica solo en TikTok?',
      r: 'Sí. Eliges entre recibir el clip como borrador en la aplicación de TikTok, para terminarlo allí, o publicarlo directamente en tu perfil sin abrir la aplicación. En la publicación directa defines una vez la privacidad y lo que la gente puede hacer, y eso vale para todos los clips.',
    },
    {
      p: '¿Necesito dejar el ordenador encendido?',
      r: 'No. Todo el procesamiento ocurre en nuestros servidores. Existe un programa opcional que hace que las descargas salgan por tu conexión y te da minutos extra en el plan, pero es opcional y tú eliges si el vídeo espera a tu ordenador o no.',
    },
    {
      p: '¿Cuántos clips salen de cada vídeo?',
      r: 'Depende del vídeo y de lo que configures: solo los mejores fragmentos, el vídeo entero troceado, o una cantidad fija. El cobro es por minuto del vídeo original, así que la cantidad de clips no cambia el precio.',
    },
    {
      p: '¿En cuánto tiempo está listo el clip?',
      r: 'Depende del tamaño del vídeo y de la cola. Un vídeo de 30 minutos suele tardar unos minutos entre detectar, transcribir, elegir los fragmentos y renderizar. Sigues el porcentaje de cada clip en la pantalla.',
    },
    {
      p: '¿Post Flow pone marca de agua en mis vídeos?',
      r: 'No. No se añade ningún logotipo nuestro al vídeo. Lo único superpuesto son los subtítulos y el título generados a partir de tu propio audio, y puedes desactivar ambos.',
    },
    {
      p: '¿Puedo usar más de un canal y más de una cuenta de TikTok?',
      r: 'Sí. Cada canal de YouTube publica en la cuenta de TikTok que le vincules, y cada cuenta tiene su propia programación. La cantidad depende del plan.',
    },
    {
      p: '¿Post Flow sirve para cortar el vídeo de otra persona?',
      r: 'No. La herramienta existe para quien ya produce su propio contenido y quiere automatizar la etapa de recortar y publicar. Al usar el servicio declaras que tienes derecho sobre el material que envías a procesar. No moderamos el contenido antes de la publicación y no nos responsabilizamos del uso indebido de material de terceros.',
    },
    {
      p: '¿Tengo que dar mi contraseña de YouTube o de TikTok?',
      r: 'No. La conexión con TikTok y con Google Drive usa el inicio de sesión oficial de cada plataforma. Autorizas en su pantalla y Post Flow nunca ve tu contraseña. Puedes revocarlo cuando quieras, desde el panel o en los ajustes de tu cuenta.',
    },
    {
      p: '¿A qué accedéis exactamente en mi Google Drive?',
      r: 'Solo a la carpeta que elijas para recibir los clips terminados. Post Flow usa un permiso que alcanza únicamente los archivos que él mismo crea: el resto de tu Drive sigue siendo invisible para nosotros.',
    },
    {
      p: '¿Los clips se guardan para siempre?',
      r: 'No. Después de publicarse se borran de nuestro servidor automáticamente, en un plazo que tú defines. Si quieres conservarlos, usa la exportación a Google Drive, donde los archivos se quedan contigo.',
    },
    {
      p: '¿Y si quiero revisar antes de publicar?',
      r: 'Puedes desactivar la publicación automática y publicar manualmente, o enviar cada clip terminado a una carpeta de tu Google Drive, separada por canal.',
    },
    {
      p: '¿Puedo cancelar cuando quiera?',
      r: `Sí, sin penalización y sin hablar con nadie. El acceso continúa hasta el final del período ya pagado. Para borrar la cuenta y todos los datos, basta con escribir a ${CONTACT.supportEmail}.`,
    },
  ],

  cadastro: {
    titulo: 'Crear cuenta',
    subtitulo: 'Lleva menos de un minuto. Después solo tienes que conectar tu canal.',
    nomeNegocio: 'Nombre del negocio',
    opcional: '(opcional)',
    email: 'Correo',
    senha: 'Contraseña',
    peloMenos8: 'Al menos 8 caracteres.',
    aceite: 'He leído y acepto los <a href="/termos" target="_blank" rel="noopener">Términos de Uso</a> y la <a href="/privacidade" target="_blank" rel="noopener">Política de Privacidad</a>, y declaro que solo voy a procesar contenido sobre el que tengo los derechos.',
    precisaAceitar: 'Tienes que aceptar los Términos de Uso y la Política de Privacidad para crear la cuenta.',
    jaTemConta: '¿Ya tienes cuenta?',
    entrar: 'Entrar',
  },

  // Mensagens de erro da API. O painel mostra o que vier em `error`,
  // entao elas precisam chegar ja no idioma de quem esta usando.
  erros: {
    alturaInvalida: "Altura del vídeo en la plantilla no válida (10 a 100).",
    arquivoSumiu: "El archivo de ese clip ya no está en el servidor.",
    arquivoSumiuReinicio: "El archivo de ese clip ya no está en el servidor (esto pasa si el servicio se reinició antes de la descarga).",
    assinaturaNaoEncontrada: "Suscripción no encontrada.",
    cadastrePixAntes: "Registra tu clave Pix antes de solicitar el retiro.",
    canalJaCadastrado: "Ese canal ya está registrado.",
    canalNaoEncontrado: "Canal no encontrado.",
    canalSemVideo: "Ese canal no tiene ningún vídeo.",
    capaNaoEncontrada: "Portada no encontrada.",
    cartaoIndisponivel: "Añadir tarjeta aún no está disponible. Habla con soporte.",
    chavePixInvalida: "Ingresa una clave Pix válida.",
    codigoDeLinkInvalido: "Código de enlace no válido. Usa solo letras, números, guiones y guiones bajos (3 a 32 caracteres).",
    codigoDeLinkJaExiste: "Ya existe un enlace con ese código.",
    codigoInvalido: "Código no válido o caducado. Genera uno nuevo en el programa.",
    coleLinkPasta: "Pega el enlace o ID de la carpeta de Drive.",
    conecteDrive: "Conecta Google Drive primero.",
    conecteDriveConfig: "Conecta Google Drive primero, en Ajustes.",
    configurePasta: "Configura una carpeta de destino para este canal primero (en la pantalla Canales).",
    contaNaoEncontrada: "Cuenta no encontrada.",
    contaTiktokInvalida: "Cuenta de TikTok no válida.",
    contaTiktokNaoEncontrada: "Cuenta de TikTok no encontrada.",
    corteNaoNaFila: "Clip no encontrado en la cola.",
    corteNaoPronto: "Clip no encontrado o aún no está listo.",
    corteSemCanal: "Ese clip no vino de un canal de YouTube, así que no tiene carpeta de destino.",
    credenciaisInvalidas: "Correo o contraseña no válidos.",
    driveInvalido: "La conexión con Google Drive ya no es válida. Vuelve a conectarla en Ajustes.",
    duracaoTituloInvalida: "Duración del título no válida (1 a 15s).",
    emailInvalido: "Indica un correo válido.",
    emailJaExiste: "Ya existe una cuenta con ese correo.",
    enquadramentoInvalido: "Encuadre no válido.",
    envieImagemAntes: "Sube la imagen de fondo antes de elegir esa opción.",
    erroNaoEncontrado: "Error no encontrado.",
    escolhaContaPasta: "Elige al menos una cuenta de TikTok para recibir los vídeos de esa carpeta.",
    escolhaContaVideo: "Elige al menos una cuenta de TikTok para recibir ese vídeo.",
    escrevaDescricao: "Escribe la descripción fija que se usará.",
    escrevaEmail: "Escribe el correo de tu cuenta.",
    estiloCorteInvalido: "Estilo de clip no válido.",
    estiloLegendaInvalido: "Estilo de subtítulo no válido.",
    estiloTituloInvalido: "Estilo de título no válido.",
    falhaEvento: "Fallo al procesar el evento.",
    formatoImagem: "Sube una imagen PNG, JPG o WEBP.",
    informeCanal: "Indica el enlace o @handle del canal.",
    informeCodigo: "Indica el código de emparejamiento.",
    informeHorario: "Indica al menos un horario válido (formato HH:MM).",
    itemNaoExisteMais: "No se pudo reintentar: el elemento de este fallo ya no existe.",
    jaTemPrograma: "Ya tienes un programa conectado. Desconecta el actual antes de emparejar otro.",
    linkExpirado: "Ese enlace caducó o ya se usó. Pide uno nuevo.",
    linkUsado: "Ese enlace ya se usó. Pide uno nuevo.",
    linkYoutubeInvalido: "Enlace de YouTube no válido. Pega la URL completa del vídeo.",
    modoAgendamentoInvalido: "Modo de programación no válido.",
    modoCorteInvalido: "Modo de corte no válido.",
    modoDescricaoInvalido: "Modo de descripción no válido.",
    modoEstiloInvalido: "Modo de estilo de clip no válido.",
    naoAutorizouPrograma: "No se pudo autorizar el programa en el servidor. Inténtalo de nuevo en un momento.",
    naoLeuVideo: "No se pudo leer ese archivo de vídeo.",
    naoRecolocouNaFila: "No se pudo volver a poner en la cola ahora.",
    naoReiniciouVideo: "No se pudo reiniciar ese vídeo ahora, inténtalo de nuevo.",
    nenhumArquivo: "Ningún archivo subido.",
    nenhumFallback: "Ningún túnel de reserva configurado todavía.",
    nenhumPrograma: "Ningún programa conectado todavía.",
    nenhumTemplate: "Ninguna plantilla subida para ese destino.",
    nenhumVideoSelecionado: "Ningún vídeo seleccionado.",
    nenhumaImagem: "No se subió ninguna imagen.",
    numeroCortesInvalido: "Número de clips no válido (1 a 30).",
    operacaoNaoRefeita: "Esa operación no se puede reintentar desde aquí.",
    ordemInvalida: "Lista de orden no válida.",
    pagamentoIndisponivel: "El pago con tarjeta aún no está disponible. Habla con soporte.",
    percentualInvalido: "Porcentaje no válido (0 a 100).",
    planoInvalido: "Plan no válido.",
    posicaoNumeracaoInvalida: "Posición de la numeración no válida.",
    posicaoVideoInvalida: "Posición del vídeo en la plantilla no válida (0 a 100).",
    postagemNaoNaFila: "Publicación no encontrada o ya salió de la cola de espera.",
    postagemSemErro: "Publicación no encontrada o no está con error.",
    programaNaoConectado: "Aún no has conectado el programa.",
    proporcaoInvalida: "Proporción no válida.",
    publicKeyInvalida: "publicKey no válida.",
    qualidadeInvalida: "Calidad no válida.",
    retencaoInvalida: "Retención no válida.",
    saldoAbaixoDoMinimo: "Tu saldo todavía no llegó al mínimo de retiro.",
    saldoInsuficiente: "Saldo insuficiente para ese retiro.",
    saqueNaoPendente: "Ese retiro ya no está pendiente.",
    senhaAtualIncorreta: "La contraseña actual no es correcta.",
    senhaCurta: "La contraseña nueva debe tener al menos 8 caracteres.",
    templateNaoEncontrado: "Plantilla no encontrada.",
    tiktokIndisponivel: "No se pudo contactar con TikTok ahora. Inténtalo de nuevo en un momento.",
    tipoChavePixInvalido: "Tipo de clave Pix no válido.",
    valorInvalido: "Valor no válido.",
    videoJaAdicionado: "Ese vídeo ya se añadió antes.",
    videoJaProcessado: "Ya has procesado ese vídeo antes.",
    videoNaoComErro: "Ese vídeo no está con error ni cancelado ahora mismo.",
    videoNaoEncontrado: "Vídeo no encontrado.",
    videoNaoNaFila: "Ese vídeo no está esperando en la cola.",
    videoNaoPausado: "Ese vídeo no está pausado ahora (o no existe).",
    videoNaoProcessando: "Ese vídeo no se está procesando ahora (o no existe).",
    videoSemCanal: "Ese vídeo no vino de un canal de YouTube, así que no tiene carpeta de destino.",
    videosPorDiaInvalido: "Vídeos por día tiene que ser un número entre 1 y 20.",
    zoomInvalido: "Zoom de encuadre no válido (0 a 100).",
  },

  contato: {
    titulo: 'Contacto y soporte',
    respondemos: 'Respondemos {tempo}.',
    emailRotulo: 'Correo',
    mesmoCanal: 'Es el mismo canal para dudas, problemas técnicos, cobros y solicitudes de eliminación de datos.',
    jaTemContaTitulo: '¿Ya tienes cuenta?',
    jaTemContaTexto: 'Si ya usas Post Flow, el camino más rápido es entrar en <a href="/client">tu panel</a>. La mayoría de las dudas se resuelven ahí:',
    atalhos: [
      '<strong>Vídeo atascado o con error</strong>. La pantalla <strong>Clips</strong> muestra el motivo y tiene el botón de reintentar.',
      '<strong>El clip no se publicó</strong>. La pestaña Cola, en <strong>Publicación</strong>, muestra la hora prevista de cada publicación, y la pestaña "Error" muestra lo que TikTok rechazó.',
      '<strong>Se acabaron mis minutos</strong>. La pantalla <strong>Plan y uso</strong> muestra el saldo y permite comprar un paquete suelto.',
      '<strong>Cambiar contraseña o correo</strong>, en <strong>Ajustes</strong>.',
    ],
    exclusaoTitulo: 'Solicitud de eliminación de datos',
    exclusaoTexto: 'Puedes pedir la eliminación de tu cuenta y de todo lo vinculado a ella escribiendo a <a href="mailto:{email}">{email}</a> desde la dirección registrada en la cuenta, con el asunto <strong>"Eliminar mi cuenta"</strong>. Borramos los vídeos, los clips, los tokens de acceso de TikTok y de Google, el historial de créditos y los datos de registro. Lo que hacemos exactamente está detallado en la <a href="/privacidade">Política de Privacidad</a>.',
    revogarTitulo: 'Revocar el acceso sin borrar la cuenta',
    revogarTexto: 'Si solo quieres que Post Flow deje de acceder a tus cuentas, no hace falta hablar con nosotros:',
    revogar: [
      '<strong>TikTok</strong>. En el panel, en <strong>Publicación</strong>, haz clic en desconectar. O, en la app de TikTok: Perfil → Ajustes → Seguridad → Apps y servicios conectados.',
      '<strong>Google Drive</strong>. En el panel, en <strong>Ajustes</strong>, desconecta Drive. O en <a href="https://myaccount.google.com/permissions" rel="noopener">myaccount.google.com/permissions</a>.',
    ],
    documentosTitulo: 'Documentos',
    metaDescricao:
      'Habla con Post Flow: soporte, dudas sobre planes, privacidad y eliminación de cuenta.',
    intro: 'Escríbenos. Respondemos {tempo}.',
    email: 'Correo',
    quandoEscrever: 'Cuándo escribir',
    motivos: [
      'Dudas sobre planes, minutos o cobros',
      'Un problema con un clip, un canal o una publicación',
      'Solicitud de eliminación de la cuenta y de los datos',
      'Dudas sobre privacidad o sobre qué datos guardamos',
    ],
    empresaTitulo: 'Quién opera el servicio',
    cnpj: 'Número de empresa (CNPJ)',
    endereco: 'Dirección',
  },

  erro: {
    titulo: 'Algo salió mal',
    voltar: 'Volver al inicio',
  },

  ...legal,
};
