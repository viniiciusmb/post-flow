import React from 'react';

// Marcas oficiais copiadas dos partials EJS da landing de verdade
// (src/web/views/partials/logo-youtube.ejs, logo-tiktok.ejs, brand-mark.ejs) -
// mesmo desenho, pra ficar identico ao resto do site.

export const YouTubeIcon: React.FC<{ size?: number }> = ({ size = 28 }) => (
  <svg width={size} height={(size * 20) / 28} viewBox="0 0 28 20" role="img" aria-label="YouTube">
    <path
      fill="#FF0000"
      d="M27.4 3.1a3.5 3.5 0 0 0-2.5-2.5C22.7 0 14 0 14 0S5.3 0 3.1.6A3.5 3.5 0 0 0 .6 3.1 36.5 36.5 0 0 0 0 10a36.5 36.5 0 0 0 .6 6.9 3.5 3.5 0 0 0 2.5 2.5C5.3 20 14 20 14 20s8.7 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5A36.5 36.5 0 0 0 28 10a36.5 36.5 0 0 0-.6-6.9Z"
    />
    <path fill="#fff" d="M11.2 14.3 18.5 10l-7.3-4.3v8.6Z" />
  </svg>
);

export const TikTokIcon: React.FC<{ size?: number }> = ({ size = 24 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label="TikTok">
    <defs>
      <path
        id="pf-tiktok-nota"
        d="M12.53.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"
      />
    </defs>
    <use href="#pf-tiktok-nota" x="-0.9" y="-0.6" fill="#25F4EE" />
    <use href="#pf-tiktok-nota" x="0.9" y="0.6" fill="#FE2C55" />
    <use href="#pf-tiktok-nota" fill="#000000" />
  </svg>
);

export const BrandMarkIcon: React.FC<{ size?: number; color?: string }> = ({ size = 24, color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill={color}
      fillRule="evenodd"
      d="M5.5 4.5h13A4.5 4.5 0 0 1 23 9v6a4.5 4.5 0 0 1-4.5 4.5h-13A4.5 4.5 0 0 1 1 15V9a4.5 4.5 0 0 1 4.5-4.5Zm0 2A2.5 2.5 0 0 0 3 9v6a2.5 2.5 0 0 0 2.5 2.5h13A2.5 2.5 0 0 0 21 15V9a2.5 2.5 0 0 0-2.5-2.5h-13Z"
    />
    <rect x="9.5" y="1.5" width="5" height="21" rx="2.5" fill={color} />
  </svg>
);

export const PlayIcon: React.FC<{ size?: number; color?: string }> = ({ size = 16, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M4 2.5v11l10-5.5-10-5.5Z" fill={color} />
  </svg>
);

export const CheckIcon: React.FC<{ size?: number; color?: string }> = ({ size = 14, color = '#fff' }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8.5 6.3 12 13 4" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
