'use strict';

// Términos de Uso y Política de Privacidad, en español.
//
// La estructura refleja exactamente legal-pt.js: mismas secciones, mismo orden.
// Cuando se añade una sección allí, hay que añadirla aquí también; un documento
// con una cláusula menos en otro idioma es peor que uno sin traducir.
//
// La empresa es brasileña y el servicio se rige por la ley brasileña, así que
// las referencias legales (LGPD, Código de Defensa del Consumidor) conservan su
// nombre original con una breve aclaración: traducir el nombre de una ley la
// vuelve imposible de encontrar.

module.exports = {
  termos: {
    titulo: 'Términos de Uso',
    atualizado: 'Última actualización: {data}',
    intro:
      'Estos términos rigen el uso de Post Flow, disponible en <a href="{site}">{site}</a>, servicio operado por <strong>{empresa}</strong>, inscrita con el número de empresa brasileño (CNPJ) <strong>{cnpj}</strong>, con domicilio en {endereco}. Al crear una cuenta, aceptas estos términos. Si no estás de acuerdo, no uses el servicio.',
    secoes: [
      {
        h: '1. Para qué existe Post Flow',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow es una herramienta de automatización para <strong>creadores de contenido que ya producen su propio material</strong>. Resuelve una etapa específica y repetitiva del trabajo de quien publica vídeo largo: recortar los mejores fragmentos, adaptarlos al formato vertical y publicarlos en las redes de vídeo corto. Nada de lo que hay aquí se hizo para reutilizar material ajeno.',
          },
          {
            tipo: 'p',
            texto:
              'En la práctica, el sistema sigue los canales de YouTube (o una carpeta de Google Drive) que le indiques, descarga los vídeos nuevos, usa inteligencia artificial para elegir los mejores fragmentos, corta cada uno en formato vertical con subtítulos y lo publica en tu TikTok o lo exporta a tu Google Drive, según lo que configures.',
          },
        ],
      },
      {
        h: '2. Tu cuenta',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'Debes tener 18 años o más.',
              'Los datos de registro deben ser verdaderos.',
              'Eres responsable de mantener tu contraseña en secreto y de todo lo que ocurra en tu cuenta.',
              'Una cuenta es para una persona o empresa. No revendas ni compartas tu acceso.',
            ],
          },
        ],
      },
      {
        h: '3. Conexión con TikTok y Google',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Al conectar tu cuenta de TikTok o de Google, autorizas a Post Flow a actuar en tu nombre dentro de los límites de los permisos que la propia plataforma muestra en el momento de la autorización. Nada más allá de eso. Los permisos exactos y el motivo de cada uno están detallados en la <a href="/privacidade">Política de Privacidad</a>.',
          },
          {
            tipo: 'p',
            texto:
              'Puedes desconectar esas cuentas en cualquier momento, desde el panel o directamente en los ajustes de TikTok/Google. Al desconectar, borramos los tokens de acceso y el servicio deja de actuar en esa cuenta de inmediato.',
          },
        ],
      },
      {
        h: '4. El contenido es tuyo, y la responsabilidad también',
        blocos: [
          {
            tipo: 'destaque',
            texto:
              '<strong>Este es el punto más importante de estos términos.</strong> Post Flow es una herramienta automática de edición: procesa el vídeo que le indiques, sin juzgar el contenido y sin revisión humana. La responsabilidad legal por el material procesado y publicado es enteramente tuya.',
          },
          { tipo: 'p', texto: 'Al usar el servicio, declaras y garantizas que:' },
          {
            tipo: 'ul',
            itens: [
              'Eres el autor del contenido que envías a procesar, o tienes autorización expresa del titular de los derechos;',
              'Tienes derecho a publicar ese material en la plataforma de destino;',
              'El contenido no infringe derechos de autor, marca, derecho de imagen ni de voz de nadie, ni las reglas de la plataforma donde se publicará;',
              'El contenido no es ilegal, no incita al odio o a la violencia y no es engañoso.',
            ],
          },
          {
            tipo: 'p',
            texto:
              '<strong>No nos responsabilizamos por recortes o publicaciones hechas a partir de contenido de terceros sin autorización.</strong> La elección de lo que entra en el sistema es tuya y ocurre antes de cualquier procesamiento: Post Flow no busca, no sugiere ni indexa contenido ajeno, y solo accede al canal o a la carpeta que tú mismo indicaste. Como no revisamos ni moderamos el material antes de la publicación, cualquier reclamación de derechos de autor, notificación extrajudicial o sanción aplicada por la plataforma de destino recae sobre quien publicó.',
          },
          {
            tipo: 'p',
            texto:
              'Si recibimos una denuncia fundamentada de uso indebido, podemos suspender o cerrar la cuenta, y cooperaremos con el titular del derecho según lo que exija la ley.',
          },
        ],
      },
      {
        h: '5. Uso prohibido',
        blocos: [
          { tipo: 'p', texto: 'No está permitido usar Post Flow para:' },
          {
            tipo: 'ul',
            itens: [
              'Procesar contenido de terceros sin autorización, incluido recortar el vídeo de otro creador para publicarlo en un perfil propio;',
              'Automatizar spam, interacción falsa o cualquier cosa que viole las reglas de TikTok;',
              'Intentar burlar los límites del plan, romper la seguridad del sistema o acceder a datos de otros clientes;',
              'Revender el servicio como si fuera tuyo, sin un acuerdo por escrito.',
            ],
          },
        ],
      },
      {
        h: '6. Planes, créditos y cobro',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'El servicio se cobra por suscripción mensual, y cada plan da una cantidad de <strong>minutos de vídeo procesado por semana</strong>. Los minutos se renuevan cada 7 días y no se acumulan de una semana a otra.',
              'Ganas <strong>minutos bonus</strong> al usar el programa opcional que hace que las descargas salgan por tu propia conexión a internet. Como eso reduce nuestro coste, el ahorro vuelve a ti.',
              'Si se acaban los minutos de la semana, el procesamiento queda en espera hasta la renovación. Puedes comprar un paquete suelto (que <strong>no caduca</strong> y se conserva de semana en semana) o activar el cobro por exceso.',
              '<strong>No se cobra nada más allá de la suscripción sin que lo autorices explícitamente.</strong> El cobro por exceso está desactivado por defecto.',
              'Los minutos se descuentan según la duración del vídeo de origen, y la reserva ocurre antes de que empiece la descarga.',
              'Los pagos los procesa <strong>Asaas</strong> (suscripción y crédito puntual, con tarjeta o PIX). <strong>Nunca guardamos los datos de tu tarjeta</strong>: se escriben en la propia pantalla de Asaas y no pasan por nuestros servidores.',
            ],
          },
        ],
      },
      {
        h: '7. Cancelación',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Puedes cancelar cuando quieras, sin penalización. El acceso continúa hasta el final del período ya pagado, y no devolvemos la parte proporcional del período en curso. Cancelar la suscripción no borra tu cuenta. Para eso, pide la eliminación en <a href="mailto:{email}">{email}</a>.',
          },
        ],
      },
      {
        h: '8. Retención de los archivos',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Los archivos de vídeo permanecen en nuestro servidor solo el tiempo necesario para procesar y publicar. El vídeo original se borra en cuanto los clips están listos, y los clips se borran automáticamente algún tiempo después de publicarse (7 días por defecto, ajustable por ti en el panel). <strong>Si quieres conservar los clips, usa la exportación a Google Drive</strong>. No somos un servicio de almacenamiento y no garantizamos que el archivo siga ahí después de ese plazo.',
          },
        ],
      },
      {
        h: '9. Disponibilidad y límites del servicio',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Hacemos lo posible por mantener todo en funcionamiento, pero Post Flow depende de servicios de terceros (YouTube, TikTok, Google, OpenAI, Anthropic, Stripe) y de la infraestructura de alojamiento. Interrupciones, cambios de política o bloqueos de esas plataformas pueden afectar el funcionamiento, y eso está fuera de nuestro control.',
          },
          {
            tipo: 'p',
            texto:
              'Del mismo modo, la elección de los fragmentos la hace una inteligencia artificial: el resultado es bueno la mayoría de las veces, pero no está garantizado ni lo revisa una persona. Revisa los clips antes de publicar cuando el contenido sea sensible.',
          },
        ],
      },
      {
        h: '10. Estado de aprobación en TikTok',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Mientras nuestra aplicación esté en fase de revisión por TikTok, las publicaciones pueden llegar como <strong>borrador</strong> a la bandeja de entrada de la app de TikTok, y tendrás que abrirlas y confirmarlas. Esa es una regla de la propia plataforma, no una limitación nuestra. Cuando se apruebe la publicación directa, pasa a valer automáticamente.',
          },
        ],
      },
      {
        h: '11. Limitación de responsabilidad',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow se ofrece "tal cual". En la medida que permite la ley brasileña, no nos responsabilizamos por lucro cesante, pérdida de audiencia, suspensión de tu cuenta en plataformas de terceros, ni daños indirectos derivados del uso del servicio. Nuestra responsabilidad total se limita al importe que hayas pagado en los 3 meses anteriores al hecho.',
          },
          {
            tipo: 'p',
            texto:
              'Nada en estos términos elimina los derechos que el Código de Defensa del Consumidor brasileño te garantiza.',
          },
        ],
      },
      {
        h: '12. Suspensión de la cuenta',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Podemos suspender o cerrar una cuenta que incumpla estos términos, especialmente en los casos del punto 5. Siempre que sea posible, avisamos antes y damos oportunidad de corregir.',
          },
        ],
      },
      {
        h: '13. Cambios en estos términos',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Si algo cambia, actualizamos la fecha al principio de esta página y avisamos en el panel antes de que el cambio entre en vigor. Seguir usando el servicio después de eso significa aceptar la nueva versión.',
          },
        ],
      },
      {
        h: '14. Ley aplicable',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Estos términos se rigen por la ley brasileña, y se elige el fuero del domicilio del consumidor para resolver cualquier disputa.',
          },
        ],
      },
      {
        h: '15. Contacto',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Dudas sobre estos términos: <a href="mailto:{email}">{email}</a>. Respondemos {tempo}. Consulta también la <a href="/contato">página de contacto</a>.',
          },
          { tipo: 'p', texto: '{empresa} · CNPJ {cnpj}<br>{endereco}' },
        ],
      },
    ],
  },

  privacidade: {
    titulo: 'Política de Privacidad',
    atualizado: 'Última actualización: {data}',
    intro:
      'Esta página explica, en español claro, qué datos guarda Post Flow, por qué los guarda, con quién los comparte y cómo borras todo. Vale para el sitio <a href="{site}">{site}</a> y para el programa de ordenador que ofrecemos para descargar.',
    resumo:
      '<strong>Resumen en tres líneas:</strong> Guardamos lo mínimo para que el servicio funcione. No vendemos tus datos ni los usamos para publicidad. Puedes desconectar tus cuentas y borrar todo cuando quieras, escribiendo a <a href="mailto:{email}">{email}</a>.',
    secoes: [
      {
        h: '1. Quién es el responsable de tus datos',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow es operado por <strong>{empresa}</strong>, inscrita con el número de empresa brasileño (CNPJ) <strong>{cnpj}</strong>, con domicilio en {endereco}. A efectos de la Ley General de Protección de Datos brasileña (LGPD, Ley 13.709/2018), esa es la empresa responsable de los datos tratados aquí.',
          },
          {
            tipo: 'p',
            texto:
              'Contacto para cualquier asunto de privacidad, incluidas solicitudes de acceso, corrección o eliminación: <a href="mailto:{email}">{email}</a>.',
          },
        ],
      },
      {
        h: '2. Para qué existe el servicio',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow es una herramienta de automatización para creadores que ya producen su propio contenido. Todo el tratamiento de datos descrito a continuación ocurre para ejecutar una tarea que tú pediste: tomar un vídeo <em>que tú indicaste</em>, cortarlo y publicarlo <em>en tu cuenta</em>. No buscamos, no indexamos ni sugerimos contenido de terceros, y no usamos tu material para entrenar ningún modelo.',
          },
        ],
      },
      {
        h: '3. Qué datos guardamos y por qué',
        blocos: [
          {
            tipo: 'tabela',
            cabecalho: ['Dato', 'Para qué sirve', 'Cuánto tiempo se guarda'],
            linhas: [
              [
                'Correo, nombre del negocio y contraseña (guardada como hash, nunca en texto)',
                'Crear y autenticar tu cuenta',
                'Mientras exista la cuenta',
              ],
              [
                'Tokens de acceso de TikTok y de Google (cifrados en la base de datos)',
                'Publicar en tu TikTok y leer/escribir en las carpetas de Drive que elegiste',
                'Hasta que desconectes la cuenta',
              ],
              [
                'Enlace del canal, título, miniatura y duración de los vídeos',
                'Detectar vídeos nuevos y mostrar el progreso en el panel',
                'Mientras exista la cuenta',
              ],
              [
                'El archivo del vídeo descargado',
                'Cortar y subtitular. Cuando dos clientes siguen el mismo canal de YouTube, el vídeo se descarga una sola vez y el archivo sirve a ambos: es contenido público idéntico y reduce el consumo de banda',
                'Se borra en cuanto nadie lo necesita, y como máximo en 48 horas',
              ],
              [
                'Transcripción del audio',
                'La IA la usa para elegir los fragmentos y para generar el texto. La transcripción de un vídeo público de YouTube se guarda y se reutiliza si otro cliente pide el mismo vídeo: es el mismo texto hablado y evita transcribirlo de nuevo',
                'Hasta 90 días, aunque borres el vídeo de tu panel',
              ],
              [
                'Los archivos de los clips terminados',
                'Publicar en TikTok y exportar a tu Drive',
                'Se borran automáticamente 3 días después de la publicación en TikTok',
              ],
              [
                'Historial de créditos, suscripción y cobros',
                'Controlar tu saldo de minutos y emitir el cobro',
                'Mientras exista la cuenta, y durante el plazo exigido por la ley fiscal tras el cierre',
              ],
              [
                'Datos de pago (tarjeta)',
                'Cobro de la suscripción y del crédito puntual',
                '<strong>Nunca pasan por nuestros servidores</strong>. Se escriben en la pantalla de Asaas y se quedan solo con ellos',
              ],
              [
                'CPF o CNPJ',
                'Exigido por el Banco Central de Brasil para el PIX Automático (el débito recurrente que tú autorizas). <strong>Solo se lo pedimos a quien elige pagar con PIX</strong>: quien paga con tarjeta nunca nos informa el documento',
                'Mientras exista la cuenta, y durante el plazo exigido por la ley fiscal tras el cierre',
              ],
            ],
          },
        ],
      },
      {
        h: '4. Qué le pedimos a Google y por qué',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Cuando conectas Google Drive, la pantalla de autorización del propio Google muestra los permisos de abajo. Eso es todo lo que pedimos:',
          },
          {
            tipo: 'tabela',
            cabecalho: ['Permiso', 'Por qué lo necesitamos'],
            linhas: [
              [
                '<code>drive.readonly</code>',
                'Leer los vídeos de la <strong>carpeta de origen</strong> que indiques, para poder procesarlos. Sin este permiso no podemos abrir el archivo que quieres cortar.',
              ],
              [
                '<code>drive.file</code>',
                'Escribir los clips terminados en la <strong>carpeta de destino</strong> que indiques. Este permiso da acceso solo a los archivos que el propio Post Flow crea. No abre el resto de tu Drive.',
              ],
              [
                '<code>userinfo.email</code>',
                'Identificar qué cuenta de Google se conectó, para mostrarla en el panel y evitar que conectes la cuenta equivocada sin darte cuenta.',
              ],
            ],
          },
          {
            tipo: 'p',
            texto:
              'No leemos, listamos ni indexamos archivos fuera de las carpetas que elegiste. No usamos datos de tu Drive para entrenar ningún modelo de inteligencia artificial.',
          },
        ],
      },
      {
        h: '5. Qué le pedimos a TikTok y por qué',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Cuando conectas tu cuenta de TikTok, la pantalla de autorización del propio TikTok muestra los permisos de abajo. Eso es todo lo que pedimos:',
          },
          {
            tipo: 'tabela',
            cabecalho: ['Permiso', 'Por qué lo necesitamos'],
            linhas: [
              [
                '<code>user.info.basic</code>',
                'Leer el nombre de usuario y la foto de la cuenta conectada, para mostrar en el panel en qué perfil va a salir el clip. Puedes conectar más de una cuenta, y sin esto no habría forma de diferenciarlas.',
              ],
              [
                '<code>user.info.stats</code>',
                'Leer seguidores, me gusta y número de vídeos del perfil, para mostrarlos en la tarjeta de la cuenta conectada. Sirve para que reconozcas la cuenta y sigas el resultado.',
              ],
              [
                '<code>video.publish</code>',
                'Publicar el clip terminado <strong>directamente en tu perfil</strong>, cuando eliges ese modo. Solo ocurre después de que defines manualmente la privacidad, lo que la gente puede hacer y la divulgación comercial.',
              ],
              [
                '<code>video.upload</code>',
                'Enviar el clip terminado <strong>como borrador</strong> a la bandeja de entrada de la app de TikTok, cuando eliges ese modo. En ese caso quien publica eres tú, dentro de la app.',
              ],
            ],
          },
          {
            tipo: 'p',
            texto:
              'No leemos tus mensajes directos, no vemos tus vídeos existentes y no publicamos nada fuera del flujo que configuraste. Solo enviamos clips generados a partir del contenido que tú mismo indicaste.',
          },
        ],
      },
      {
        h: '6. Servicios de terceros que usamos',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Para funcionar, Post Flow envía datos a estas empresas, y nada más allá de lo necesario:',
          },
          {
            tipo: 'ul',
            itens: [
              '<strong>OpenAI (Whisper)</strong>. Recibe el <em>audio</em> de tu vídeo para transcribirlo.',
              '<strong>Anthropic (Claude)</strong>. Recibe la <em>transcripción en texto</em> para elegir los mejores fragmentos. No recibe el vídeo ni el audio.',
              '<strong>TikTok</strong>. Recibe los clips que mandaste publicar.',
              '<strong>Google Drive</strong>. Recibe los clips que mandaste exportar.',
              '<strong>Asaas</strong>. Procesa la suscripción y la compra de crédito (tarjeta y PIX) y guarda los datos de la tarjeta. Recibe tu nombre, correo y, en el PIX Automático, tu CPF o CNPJ.',
              '<strong>Stripe</strong>. Se usa solo para el cobro automático de excedente de quien activó esa opción, y guarda los datos de esa tarjeta.',
              '<strong>Hostinger</strong>. Aloja el servidor donde funciona el sistema.',
            ],
          },
          {
            tipo: 'p',
            texto:
              '<strong>No vendemos tus datos y no usamos rastreadores publicitarios de terceros.</strong>',
          },
        ],
      },
      {
        h: '7. Cookies',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow usa solo cookies <strong>estrictamente necesarias</strong> para funcionar. No hay Google Analytics, ni píxel de Facebook, ni ningún rastreador de publicidad en el sitio. Son tres:',
          },
          {
            tipo: 'ul',
            itens: [
              '<code>connect.sid</code>. Te mantiene con la sesión iniciada. Sin ella, saldrías de la sesión en cada clic.',
              '<code>csrf_token</code>. Protege contra que otro sitio consiga disparar acciones en tu cuenta sin que lo sepas.',
              '<code>lang</code>. Guarda el idioma que elegiste, para que el sitio se abra en él la próxima vez.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'Como son imprescindibles para el servicio, no requieren banner de consentimiento. Borrar las cookies del navegador simplemente cierra tu sesión.',
          },
        ],
      },
      {
        h: '8. El programa de ordenador (túnel)',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Ofrecemos un pequeño programa opcional que se queda en la bandeja del sistema. Sirve para que las descargas de tus vídeos salgan por tu propia conexión a internet en vez de la de nuestro servidor. Eso resuelve bloqueos de YouTube y te da minutos bonus.',
          },
          {
            tipo: 'p',
            texto:
              '<strong>No lee tus archivos</strong>, no monitoriza tu navegación y no recoge nada de tu ordenador. Solo abre un canal de salida de red que nuestro servidor usa exclusivamente para descargar los vídeos que tú mismo mandaste procesar. Puedes cerrarlo o desinstalarlo en cualquier momento.',
          },
        ],
      },
      {
        h: '9. Seguridad',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'Todo el tráfico del sitio está cifrado (HTTPS).',
              'Las contraseñas se guardan como hash bcrypt. Ni nosotros podemos leerlas.',
              'Los tokens de TikTok y de Google están cifrados en la base de datos (AES-256-GCM).',
              'Cada cliente solo ve sus propios datos; eso se verifica con pruebas automatizadas en cada cambio del sistema.',
              'La base de datos tiene copia de seguridad diaria verificada.',
            ],
          },
        ],
      },
      {
        h: '10. Tus derechos',
        blocos: [
          { tipo: 'p', texto: 'Según la LGPD, puedes en cualquier momento:' },
          {
            tipo: 'ul',
            itens: [
              '<strong>Ver</strong> qué datos tenemos sobre ti;',
              '<strong>Corregir</strong> datos incorrectos (el correo y el nombre se editan directamente en el panel);',
              '<strong>Borrar</strong> tu cuenta y todos los datos vinculados a ella;',
              '<strong>Revocar</strong> el acceso a TikTok y a Google sin borrar la cuenta;',
              '<strong>Pedir una copia</strong> de tus datos.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'Para cualquiera de estos, escribe a <a href="mailto:{email}">{email}</a> desde el correo registrado en tu cuenta. Respondemos {tempo}.',
          },
        ],
      },
      {
        h: '11. Cómo borramos todo',
        blocos: [
          { tipo: 'p', texto: 'Al recibir una solicitud de eliminación, borramos:' },
          {
            tipo: 'ul',
            itens: [
              'Tu registro (correo, contraseña, nombre del negocio);',
              'Todos los canales, vídeos, transcripciones y clips;',
              'Los archivos de vídeo que sigan en el servidor;',
              'Los tokens de acceso de TikTok y de Google (el acceso se revoca de inmediato);',
              'El historial de créditos y los vínculos con Asaas y Stripe.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'Solo quedan los registros de cobro que la legislación fiscal obliga a conservar, y únicamente durante el plazo exigido. <strong>Lo que ya se publicó en tu TikTok y lo que ya se exportó a tu Google Drive sigue siendo tuyo</strong>. No podemos (ni debemos) tocar eso.',
          },
        ],
      },
      {
        h: '12. Menores de edad',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow no está dirigido a menores de 18 años. Si detectamos una cuenta en esa situación, se cerrará y los datos se borrarán.',
          },
        ],
      },
      {
        h: '13. Cambios en esta política',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Si algo cambia, actualizamos la fecha al principio de esta página. Los cambios relevantes se avisarán en el panel antes de entrar en vigor.',
          },
        ],
      },
    ],
  },
};
