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
