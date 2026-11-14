import React, { useState } from 'react';

export const CHIIKAWA_BG_IMAGE =
  '/assets/aistudio/Screenshot_2026-11-14_212556_d3f359eb.png';

export const MeadowBackground: React.FC = () => {
  const [imgFailed, setImgFailed] = useState(false);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden bg-gradient-to-b from-[#FAD0DC] via-[#F9C6D3] to-[#E6F1D8]"
    >
      {/* Full-screen fixed uploaded Chiikawa illustration */}
      {!imgFailed && (
        <img
          src={CHIIKAWA_BG_IMAGE}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className="h-full w-full object-cover object-bottom opacity-90"
        />
      )}

      {/* Soft translucent meadow-pink gradient wash for card legibility */}
      <div className="absolute inset-0 bg-gradient-to-b from-[#FFF7FA]/35 via-[#FCE7EF]/20 to-[#EBF5DF]/30" />

      {/* Centered background caption in the open sky band */}
      <div className="absolute inset-x-0 top-[116px] flex justify-center px-4 md:top-[82px]">
        <p className="font-display text-sm font-semibold tracking-wide text-[#5C2D41] drop-shadow-[0_1px_4px_rgba(255,255,255,0.85)] sm:text-base">
          study with chiikawas!
        </p>
      </div>

      {/* Subtle swaying grass tufts tucked at outer bottom corners so center characters stay clear */}
      <div className="absolute bottom-1 left-[2%] hidden animate-sway sm:block">
        <GrassTuft withDaisy />
      </div>
      <div className="absolute bottom-1 right-[2%] hidden animate-sway-slow sm:block">
        <GrassTuft withDaisy />
      </div>
    </div>
  );
};

function GrassTuft({ withDaisy = false }: { withDaisy?: boolean }) {
  return (
    <svg width="64" height="52" viewBox="0 0 64 52" fill="none">
      <path
        d="M22 50 C19 34 12 22 6 14 C15 20 22 31 26 50 Z"
        fill="#7FB95A"
      />
      <path
        d="M30 50 C29 30 31 16 34 6 C35 18 35 32 35 50 Z"
        fill="#6BA848"
      />
      <path
        d="M38 50 C41 34 48 22 56 16 C48 24 44 35 42 50 Z"
        fill="#7FB95A"
      />
      {withDaisy && (
        <g transform="translate(46, 14)">
          <circle cx="0" cy="-4" r="3" fill="#FFFDF7" />
          <circle cx="4" cy="0" r="3" fill="#FFFDF7" />
          <circle cx="0" cy="4" r="3" fill="#FFFDF7" />
          <circle cx="-4" cy="0" r="3" fill="#FFFDF7" />
          <circle cx="0" cy="0" r="2.3" fill="#FBBF24" />
        </g>
      )}
    </svg>
  );
}
