'use strict';

// Terms of Use and Privacy Policy, in English.
//
// Structure mirrors legal-pt.js exactly - same sections, same order. When a
// section is added there, add it here too; a document that is one clause
// shorter in another language is worse than one that is not translated at all.
//
// The company is Brazilian and the service is governed by Brazilian law, so the
// legal references (LGPD, Consumer Defence Code) stay named as they are, with a
// short gloss. Translating a statute's name would make it unfindable.

module.exports = {
  termos: {
    titulo: 'Terms of Use',
    atualizado: 'Last updated: {data}',
    intro:
      'These terms govern the use of Post Flow, available at <a href="{site}">{site}</a>, a service operated by <strong>{empresa}</strong>, registered under Brazilian company number (CNPJ) <strong>{cnpj}</strong>, with offices at {endereco}. By creating an account you agree to them. If you do not agree, do not use the service.',
    secoes: [
      {
        h: '1. What Post Flow is for',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow is an automation tool for <strong>creators who already produce their own material</strong>. It solves one specific, repetitive step in the work of anyone who publishes long-form video: cutting out the best moments, adapting them to vertical format and publishing them on short-form networks. Nothing here was built to repurpose someone else\'s material.',
          },
          {
            tipo: 'p',
            texto:
              'In practice, the system watches the YouTube channels (or a Google Drive folder) you point it at, downloads new videos, uses artificial intelligence to pick the best segments, renders each segment in vertical format with captions, and publishes to your TikTok or exports to your Google Drive, according to your settings.',
          },
        ],
      },
      {
        h: '2. Your account',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'You must be 18 or older.',
              'Your registration details must be truthful.',
              'You are responsible for keeping your password secret and for everything that happens in your account.',
              'One account is for one person or company. Do not resell or share your access.',
            ],
          },
        ],
      },
      {
        h: '3. Connecting TikTok and Google',
        blocos: [
          {
            tipo: 'p',
            texto:
              'By connecting your TikTok or Google account, you authorise Post Flow to act on your behalf within the limits of the permissions that the platform itself displays at the moment of authorisation. Nothing beyond that. The exact permissions and the reason for each one are detailed in the <a href="/privacidade">Privacy Policy</a>.',
          },
          {
            tipo: 'p',
            texto:
              'You can disconnect these accounts at any time, from the dashboard or directly in your TikTok/Google settings. On disconnection we delete the access tokens and the service stops acting on that account immediately.',
          },
        ],
      },
      {
        h: '4. The content is yours, and so is the responsibility for it',
        blocos: [
          {
            tipo: 'destaque',
            texto:
              '<strong>This is the most important point in these terms.</strong> Post Flow is an automatic editing tool: it processes the video you point it at, without judging the content and without human review. Legal responsibility for the material processed and published is entirely yours.',
          },
          { tipo: 'p', texto: 'By using the service, you declare and warrant that:' },
          {
            tipo: 'ul',
            itens: [
              'You are the author of the content you submit for processing, or you have express authorisation from the rights holder;',
              'You have the right to publish that material on the destination platform;',
              'The content does not infringe anyone\'s copyright, trademark, image rights or voice rights, nor the rules of the platform where it will be published;',
              'The content is not illegal, does not incite hatred or violence, and is not deceptive.',
            ],
          },
          {
            tipo: 'p',
            texto:
              '<strong>We are not responsible for clips or posts made from third-party content without authorisation.</strong> The choice of what enters the system is yours and happens before any processing: Post Flow does not search for, suggest or index anyone else\'s content, and only accesses the channel or folder you pointed it at yourself. Because we do not review or moderate material before publication, any copyright complaint, legal notice or penalty applied by the destination platform falls on whoever published it.',
          },
          {
            tipo: 'p',
            texto:
              'If we receive a substantiated report of misuse, we may suspend or terminate the account, and we will cooperate with the rights holder as required by law.',
          },
        ],
      },
      {
        h: '5. Prohibited use',
        blocos: [
          { tipo: 'p', texto: 'You may not use Post Flow to:' },
          {
            tipo: 'ul',
            itens: [
              'Process third-party content without authorisation, including clipping another creator\'s video to publish on your own profile;',
              'Automate spam, fake engagement or anything that violates TikTok\'s rules;',
              'Attempt to bypass plan limits, break the system\'s security or access other clients\' data;',
              'Resell the service as if it were your own, without a written agreement.',
            ],
          },
        ],
      },
      {
        h: '6. Plans, credits and billing',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'The service is billed as a monthly subscription, and each plan grants an amount of <strong>minutes of video processed per week</strong>. Minutes renew every 7 days and do not roll over from one week to the next.',
              'You earn <strong>bonus minutes</strong> by using the optional program that routes downloads through your own internet connection. Because that lowers our cost, the saving comes back to you.',
              'If the week\'s minutes run out, processing waits until they renew. You can buy a one-off pack (which <strong>does not expire</strong> and carries over week to week) or turn on overage billing.',
              '<strong>Nothing is charged beyond the subscription without your explicit authorisation.</strong> Overage billing is off by default.',
              'Minutes are debited based on the duration of the source video, and the reservation happens before the download starts.',
              'Payments are processed by Stripe. We do not store your card details.',
            ],
          },
        ],
      },
      {
        h: '7. Cancellation',
        blocos: [
          {
            tipo: 'p',
            texto:
              'You can cancel whenever you want, with no penalty. Access continues until the end of the period already paid for, and we do not refund the remainder of a period in progress. Cancelling the subscription does not delete your account. For that, request deletion at <a href="mailto:{email}">{email}</a>.',
          },
        ],
      },
      {
        h: '8. File retention',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Video files stay on our server only as long as needed to process and publish. The source video is deleted as soon as the clips are ready, and the clips are deleted automatically some time after they are published (7 days by default, adjustable by you in the dashboard). <strong>If you want to keep the clips, use the export to Google Drive</strong>. We are not a storage service and we do not guarantee the file will still be there after that period.',
          },
        ],
      },
      {
        h: '9. Availability and limits of the service',
        blocos: [
          {
            tipo: 'p',
            texto:
              'We do our best to keep everything running, but Post Flow depends on third-party services (YouTube, TikTok, Google, OpenAI, Anthropic, Stripe) and on hosting infrastructure. Outages, policy changes or blocks by those platforms can affect how it works, and that is outside our control.',
          },
          {
            tipo: 'p',
            texto:
              'Likewise, the choice of segments is made by artificial intelligence: the result is good most of the time, but it is neither guaranteed nor reviewed by a person. Check the clips before publishing when the content is sensitive.',
          },
        ],
      },
      {
        h: '10. TikTok approval status',
        blocos: [
          {
            tipo: 'p',
            texto:
              'While our application is under review by TikTok, posts may arrive as a <strong>draft</strong> in your TikTok app inbox, requiring you to open and confirm them. That is a rule of the platform itself, not a limitation of ours. Once direct posting is approved, it takes effect automatically.',
          },
        ],
      },
      {
        h: '11. Limitation of liability',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow is provided "as is". To the extent permitted by Brazilian law, we are not liable for lost profits, lost audience, suspension of your account on third-party platforms, or indirect damages arising from use of the service. Our total liability is limited to the amount you paid in the 3 months preceding the event.',
          },
          {
            tipo: 'p',
            texto:
              'Nothing in these terms removes the rights guaranteed to you by the Brazilian Consumer Defence Code.',
          },
        ],
      },
      {
        h: '12. Account suspension',
        blocos: [
          {
            tipo: 'p',
            texto:
              'We may suspend or terminate an account that breaches these terms, particularly in the cases in section 5. Wherever possible, we warn you first and give you a chance to fix it.',
          },
        ],
      },
      {
        h: '13. Changes to these terms',
        blocos: [
          {
            tipo: 'p',
            texto:
              'If anything changes, we update the date at the top of this page and notify you in the dashboard before the change takes effect. Continuing to use the service after that means accepting the new version.',
          },
        ],
      },
      {
        h: '14. Governing law',
        blocos: [
          {
            tipo: 'p',
            texto:
              'These terms are governed by Brazilian law, and the courts of the consumer\'s domicile are chosen to resolve any dispute.',
          },
        ],
      },
      {
        h: '15. Contact',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Questions about these terms: <a href="mailto:{email}">{email}</a>. We reply {tempo}. See also the <a href="/contato">contact page</a>.',
          },
          { tipo: 'p', texto: '{empresa} · CNPJ {cnpj}<br>{endereco}' },
        ],
      },
    ],
  },

  privacidade: {
    titulo: 'Privacy Policy',
    atualizado: 'Last updated: {data}',
    intro:
      'This page explains, in plain English, what data Post Flow stores, why it stores it, who it is shared with and how you delete everything. It applies to the website <a href="{site}">{site}</a> and to the desktop program we offer for download.',
    resumo:
      '<strong>Summary in three lines:</strong> We store the minimum needed for the service to work. We do not sell your data and we do not use it for advertising. You can disconnect your accounts and delete everything whenever you want, by emailing <a href="mailto:{email}">{email}</a>.',
    secoes: [
      {
        h: '1. Who controls your data',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow is operated by <strong>{empresa}</strong>, registered under Brazilian company number (CNPJ) <strong>{cnpj}</strong>, with offices at {endereco}. For the purposes of the Brazilian General Data Protection Law (LGPD, Law 13.709/2018), that is the controller of the data processed here.',
          },
          {
            tipo: 'p',
            texto:
              'Contact for any privacy matter, including requests for access, correction or deletion: <a href="mailto:{email}">{email}</a>.',
          },
        ],
      },
      {
        h: '2. What the service is for',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow is an automation tool for creators who already produce their own content. All the data processing described below happens in order to carry out a task you asked for: take a video <em>you pointed us at</em>, cut it and publish it <em>on your account</em>. We do not search for, index or suggest third-party content, and we do not use your material to train any model.',
          },
        ],
      },
      {
        h: '3. What data we store and why',
        blocos: [
          {
            tipo: 'tabela',
            cabecalho: ['Data', 'What it is for', 'How long we keep it'],
            linhas: [
              [
                'Email, business name and password (stored as a hash, never as text)',
                'Creating and authenticating your account',
                'For as long as the account exists',
              ],
              [
                'TikTok and Google access tokens (encrypted in the database)',
                'Publishing to your TikTok and reading/writing in the Drive folders you chose',
                'Until you disconnect the account',
              ],
              [
                'Channel link, title, thumbnail and duration of videos',
                'Detecting new videos and showing progress in the dashboard',
                'For as long as the account exists',
              ],
              ['The downloaded video file', 'Cutting and captioning', 'Deleted as soon as the clips are ready'],
              [
                'Audio transcript',
                'The AI uses it to pick segments and to write the caption',
                'For as long as the video exists in your dashboard',
              ],
              [
                'The finished clip files',
                'Publishing to TikTok and exporting to your Drive',
                'Deleted automatically after publication (7 days by default, adjustable by you)',
              ],
              [
                'Credit, subscription and billing history',
                'Tracking your minute balance and issuing charges',
                'For as long as the account exists, and for the period required by tax law after closure',
              ],
              [
                'Payment data (card)',
                'Subscription billing',
                '<strong>Never passes through our servers</strong>. It stays with Stripe only',
              ],
            ],
          },
        ],
      },
      {
        h: '4. What we ask Google for, and why',
        blocos: [
          {
            tipo: 'p',
            texto:
              'When you connect Google Drive, Google\'s own authorisation screen shows the permissions below. That is all we ask for:',
          },
          {
            tipo: 'tabela',
            cabecalho: ['Permission', 'Why we need it'],
            linhas: [
              [
                '<code>drive.readonly</code>',
                'To read the videos in the <strong>source folder</strong> you point us at, so we can process them. Without this permission we cannot open the file you want to cut.',
              ],
              [
                '<code>drive.file</code>',
                'To write the finished clips into the <strong>destination folder</strong> you point us at. This permission grants access only to the files Post Flow itself creates. It does not open the rest of your Drive.',
              ],
              [
                '<code>userinfo.email</code>',
                'To identify which Google account was connected, so we can show it in the dashboard and stop you connecting the wrong account without noticing.',
              ],
            ],
          },
          {
            tipo: 'p',
            texto:
              'We do not read, list or index files outside the folders you chose. We do not use data from your Drive to train any artificial intelligence model.',
          },
        ],
      },
      {
        h: '5. What we ask TikTok for, and why',
        blocos: [
          {
            tipo: 'p',
            texto:
              "When you connect your TikTok account, TikTok's own authorisation screen shows the permissions below. That is all we ask for:",
          },
          {
            tipo: 'tabela',
            cabecalho: ['Permission', 'Why we need it'],
            linhas: [
              [
                '<code>user.info.basic</code>',
                'To read the username and picture of the connected account, so we can show in the dashboard which profile the clip will go to. You can connect more than one account, and without this there would be no way to tell them apart.',
              ],
              [
                '<code>user.info.stats</code>',
                "To read followers, likes and the profile's video count, to display on the connected account card. It helps you recognise the account and follow the results.",
              ],
              [
                '<code>video.publish</code>',
                'To publish the finished clip <strong>straight to your profile</strong>, when you choose that mode. It only happens after you manually set the privacy level, what people can do and the commercial disclosure.',
              ],
              [
                '<code>video.upload</code>',
                'To send the finished clip <strong>as a draft</strong> to your TikTok app inbox, when you choose that mode. In that case you are the one who publishes, inside the app.',
              ],
            ],
          },
          {
            tipo: 'p',
            texto:
              'We do not read your direct messages, we do not see your existing videos and we do not publish anything outside the flow you configured. We only send clips generated from content you pointed us at yourself.',
          },
        ],
      },
      {
        h: '6. Third-party services we use',
        blocos: [
          {
            tipo: 'p',
            texto:
              'To work, Post Flow sends data to these companies, and nothing beyond what is necessary:',
          },
          {
            tipo: 'ul',
            itens: [
              '<strong>OpenAI (Whisper)</strong>. Receives the <em>audio</em> of your video to transcribe it.',
              '<strong>Anthropic (Claude)</strong>. Receives the <em>text transcript</em> to pick the best segments. It does not receive the video or the audio.',
              '<strong>TikTok</strong>. Receives the clips you asked to publish.',
              '<strong>Google Drive</strong>. Receives the clips you asked to export.',
              '<strong>Stripe</strong>. Processes payments and stores card data.',
              '<strong>Hostinger</strong>. Hosts the server the system runs on.',
            ],
          },
          {
            tipo: 'p',
            texto:
              '<strong>We do not sell your data and we do not use third-party advertising trackers.</strong>',
          },
        ],
      },
      {
        h: '7. Cookies',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow uses only <strong>strictly necessary</strong> cookies. There is no Google Analytics, no Facebook pixel and no advertising tracker on the site. There are three:',
          },
          {
            tipo: 'ul',
            itens: [
              '<code>connect.sid</code>. Keeps you signed in. Without it you would be signed out on every click.',
              '<code>csrf_token</code>. Protects against another site triggering actions in your account without your knowledge.',
              '<code>lang</code>. Stores the language you chose, so the site opens in it next time.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'Because they are indispensable to the service, they do not require a consent banner. Clearing your browser cookies simply ends your session.',
          },
        ],
      },
      {
        h: '8. The desktop program (tunnel)',
        blocos: [
          {
            tipo: 'p',
            texto:
              'We offer a small optional program that sits in your system tray. Its job is to make the downloads of your videos go out through your own internet connection instead of our server\'s. That solves YouTube blocks and earns you bonus minutes.',
          },
          {
            tipo: 'p',
            texto:
              'It <strong>does not read your files</strong>, does not monitor your browsing and does not collect anything from your machine. It only opens a network exit channel that our server uses exclusively to download the videos you asked to process. You can close or uninstall it at any time.',
          },
        ],
      },
      {
        h: '9. Security',
        blocos: [
          {
            tipo: 'ul',
            itens: [
              'All site traffic is encrypted (HTTPS).',
              'Passwords are stored as bcrypt hashes. Not even we can read them.',
              'TikTok and Google tokens are encrypted in the database (AES-256-GCM).',
              'Each client can only see their own data; this is verified by automated tests on every change to the system.',
              'The database has a verified daily backup.',
            ],
          },
        ],
      },
      {
        h: '10. Your rights',
        blocos: [
          { tipo: 'p', texto: 'Under the LGPD, you may at any time:' },
          {
            tipo: 'ul',
            itens: [
              '<strong>See</strong> what data we hold about you;',
              '<strong>Correct</strong> wrong data (email and name can be edited directly in the dashboard);',
              '<strong>Delete</strong> your account and all data linked to it;',
              '<strong>Revoke</strong> TikTok and Google access without deleting the account;',
              '<strong>Request a copy</strong> of your data.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'For any of these, write to <a href="mailto:{email}">{email}</a> from the email registered on your account. We reply {tempo}.',
          },
        ],
      },
      {
        h: '11. How we delete everything',
        blocos: [
          { tipo: 'p', texto: 'On receiving a deletion request, we delete:' },
          {
            tipo: 'ul',
            itens: [
              'Your registration (email, password, business name);',
              'All channels, videos, transcripts and clips;',
              'Any video files still on the server;',
              'TikTok and Google access tokens (access is revoked immediately);',
              'Credit history and the link to Stripe.',
            ],
          },
          {
            tipo: 'p',
            texto:
              'Only the billing records that tax legislation requires us to keep remain, and only for the required period. <strong>What has already been published on your TikTok and what has already been exported to your Google Drive stays with you</strong>. We have no way to (and should not) touch that.',
          },
        ],
      },
      {
        h: '12. Minors',
        blocos: [
          {
            tipo: 'p',
            texto:
              'Post Flow is not intended for anyone under 18. If we identify an account in that situation, it will be closed and the data deleted.',
          },
        ],
      },
      {
        h: '13. Changes to this policy',
        blocos: [
          {
            tipo: 'p',
            texto:
              'If anything changes, we update the date at the top of this page. Significant changes will be announced in the dashboard before they take effect.',
          },
        ],
      },
    ],
  },
};
