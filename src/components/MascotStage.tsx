import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { MascotId, MascotMood } from '../types/quiz';

interface MascotStageProps {
  mascotId: MascotId;
  mood: MascotMood;
  message?: string;
  streak?: number;
  compact?: boolean;
  embedded?: boolean;
}

export const MASCOT_PROFILES: Record<
  Exclude<MascotId, 'trio'>,
  { name: string; role: string; tagline: string; accent: string }
> = {
  mochi: {
    name: 'Mochi',
    role: 'Meadow Fluff',
    tagline: 'Cheers softly on every recall and jumps with joy on streaks.',
    accent: '#F4A6B8',
  },
  pip: {
    name: 'Pip',
    role: 'Clover Explorer',
    tagline: 'Carries a lucky sprout and celebrates effortless Easy answers.',
    accent: '#78B6E8',
  },
  bramble: {
    name: 'Bramble',
    role: 'Satchel Bear',
    tagline: 'Stays steady during tricky reviews and cheers on deck mastery.',
    accent: '#E8B878',
  },
};

export const MascotStage: React.FC<MascotStageProps> = ({
  mascotId,
  mood,
  message,
  streak = 0,
  compact = false,
  embedded = false,
}) => {
  const isCelebrating =
    mood === 'celebrate_good' ||
    mood === 'celebrate_easy' ||
    mood === 'celebrate_streak' ||
    mood === 'celebrate_mastery';

  const showAllFriends =
    mascotId === 'trio' || mood === 'celebrate_streak' || mood === 'celebrate_mastery';

  return (
    <div
      data-testid="mascot-stage"
      data-mood={mood}
      className={`relative flex flex-col items-center justify-center rounded-2xl bg-gradient-to-b from-[#FFFFFF] via-[#F9FCF5] to-[#EAF4DE] ${
        embedded ? '' : 'border border-[#D8E3CE]'
      } ${compact ? 'px-4 py-4' : 'px-6 py-6'}`}
    >
      {/* Floating celebration particles */}
      <AnimatePresence>
        {isCelebrating && (
          <motion.div
            key={`burst-${mood}-${streak}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 overflow-hidden"
          >
            {[
              { left: '15%', delay: 0, kind: 'clover' },
              { left: '28%', delay: 0.08, kind: 'star' },
              { left: '50%', delay: 0.04, kind: 'flower' },
              { left: '72%', delay: 0.1, kind: 'clover' },
              { left: '84%', delay: 0.02, kind: 'star' },
            ].map((p, idx) => (
              <motion.div
                key={idx}
                initial={{ y: 70, opacity: 0, scale: 0.5, rotate: -15 }}
                animate={{
                  y: [-10, -45, -75],
                  opacity: [0, 1, 0],
                  scale: [0.6, 1.15, 0.9],
                  rotate: [0, 18, -12],
                }}
                transition={{ duration: 1.25, delay: p.delay, ease: 'easeOut' }}
                style={{ left: p.left, bottom: '28%' }}
                className="absolute"
              >
                {p.kind === 'clover' && <CloverParticle />}
                {p.kind === 'star' && <StarParticle />}
                {p.kind === 'flower' && <FlowerParticle />}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Speech bubble */}
      {message && (
        <motion.div
          key={message}
          initial={{ opacity: 0, y: 4, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18 }}
          className="relative mb-3 max-w-xs rounded-xl border border-[#D4DFC7] bg-white px-3.5 py-2 text-center text-xs font-medium text-[#2A3729] shadow-xs"
        >
          {message}
          <span
            aria-hidden="true"
            className="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 rotate-45 border-b border-r border-[#D4DFC7] bg-white"
          />
        </motion.div>
      )}

      {/* Character stage */}
      <div className="relative flex items-end justify-center gap-3 pt-1">
        {showAllFriends ? (
          <>
            <AnimatedCritter
              variant="pip"
              mood={mood}
              size={compact ? 80 : 94}
              delay={0.05}
            />
            <AnimatedCritter
              variant="mochi"
              mood={mood}
              size={compact ? 94 : 112}
              delay={0}
            />
            <AnimatedCritter
              variant="bramble"
              mood={mood}
              size={compact ? 80 : 94}
              delay={0.1}
            />
          </>
        ) : (
          <AnimatedCritter
            variant={mascotId}
            mood={mood}
            size={compact ? 98 : 124}
            delay={0}
          />
        )}
      </div>

      {/* Grass tuft cushion under feet */}
      <svg
        aria-hidden="true"
        viewBox="0 0 220 18"
        className="-mt-1 h-4 w-44 text-[#93C46D]"
      >
        <ellipse cx="110" cy="11" rx="96" ry="5" fill="#C4E2A5" />
        <path
          d="M36 12 Q32 3 26 6 Q34 9 38 12 M180 12 Q184 2 190 5 Q182 9 178 12"
          stroke="#6FA94D"
          strokeWidth="2"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    </div>
  );
};

interface AnimatedCritterProps {
  variant: Exclude<MascotId, 'trio'>;
  mood: MascotMood;
  size: number;
  delay?: number;
}

export const MascotAvatar: React.FC<{
  variant: Exclude<MascotId, 'trio'>;
  mood?: MascotMood;
  size?: number;
}> = ({ variant, mood = 'idle', size = 64 }) => (
  <CritterSvg variant={variant} mood={mood} size={size} />
);

const AnimatedCritter: React.FC<AnimatedCritterProps> = ({
  variant,
  mood,
  size,
  delay = 0,
}) => {
  const getMotionProps = () => {
    switch (mood) {
      case 'celebrate_good':
        return {
          animate: { y: [0, -16, 0, -9, 0], rotate: [0, -4, 4, 0] },
          transition: { duration: 0.75, delay, ease: 'easeOut' as const },
        };
      case 'celebrate_easy':
        return {
          animate: {
            y: [0, -22, 0, -14, 0],
            scale: [1, 1.07, 0.96, 1.04, 1],
            rotate: [0, -8, 8, -4, 0],
          },
          transition: { duration: 0.85, delay, ease: 'easeOut' as const },
        };
      case 'celebrate_streak':
      case 'celebrate_mastery':
        return {
          animate: {
            y: [0, -20, 0, -16, 0],
            rotate: [0, -6, 6, -6, 0],
          },
          transition: {
            duration: 0.9,
            delay,
            repeat: 1,
            ease: 'easeInOut' as const,
          },
        };
      case 'thinking':
        return {
          animate: { rotate: [-2, -5, -2], y: [0, -2, 0] },
          transition: { duration: 2.2, repeat: Infinity, ease: 'easeInOut' as const },
        };
      case 'encourage':
        return {
          animate: { x: [-3, 3, -2, 2, 0], y: [0, 2, 0] },
          transition: { duration: 0.55, ease: 'easeInOut' as const },
        };
      default:
        return {
          animate: { y: [0, -3.5, 0] },
          transition: {
            duration: 2.8,
            delay,
            repeat: Infinity,
            ease: 'easeInOut' as const,
          },
        };
    }
  };

  const motionCfg = getMotionProps();

  return (
    <motion.div
      animate={motionCfg.animate}
      transition={motionCfg.transition}
      className="relative flex items-center justify-center"
    >
      <CritterSvg variant={variant} mood={mood} size={size} />
    </motion.div>
  );
};

function CritterSvg({
  variant,
  mood,
  size,
}: {
  variant: Exclude<MascotId, 'trio'>;
  mood: MascotMood;
  size: number;
}) {
  const isHappy =
    mood === 'celebrate_good' ||
    mood === 'celebrate_easy' ||
    mood === 'celebrate_streak' ||
    mood === 'celebrate_mastery';

  const bodyFill =
    variant === 'mochi'
      ? '#FFFDF9'
      : variant === 'pip'
      ? '#F4FAFF'
      : '#FFF6E8';

  const earFill =
    variant === 'mochi'
      ? '#FFFDF9'
      : variant === 'pip'
      ? '#9CCCF2'
      : '#E9C28D';

  const cheekFill =
    variant === 'mochi'
      ? '#F7A8B8'
      : variant === 'pip'
      ? '#F9B4C2'
      : '#F2A38C';

  const ink = '#2F2B28';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-label={`${MASCOT_PROFILES[variant].name} companion`}
    >
      {/* Mastery Flower Crown */}
      {mood === 'celebrate_mastery' && (
        <g transform="translate(60, 18)">
          <path
            d="M-18 6 Q0 -2 18 6"
            stroke="#4D9E5D"
            strokeWidth="3"
            strokeLinecap="round"
            fill="none"
          />
          <circle cx="-11" cy="2" r="4" fill="#FDE047" stroke={ink} strokeWidth="1.5" />
          <circle cx="0" cy="-1" r="4.5" fill="#FFFDF7" stroke={ink} strokeWidth="1.5" />
          <circle cx="0" cy="-1" r="1.8" fill="#F59E0B" />
          <circle cx="11" cy="2" r="4" fill="#FDE047" stroke={ink} strokeWidth="1.5" />
        </g>
      )}

      {/* Ears by character */}
      {variant === 'mochi' && (
        <g>
          <ellipse cx="36" cy="28" rx="10" ry="13" fill={earFill} stroke={ink} strokeWidth="2.8" />
          <ellipse cx="36" cy="29" rx="5" ry="7" fill="#FAD2DC" />
          <ellipse cx="84" cy="28" rx="10" ry="13" fill={earFill} stroke={ink} strokeWidth="2.8" />
          <ellipse cx="84" cy="29" rx="5" ry="7" fill="#FAD2DC" />
        </g>
      )}

      {variant === 'pip' && (
        <g>
          {/* Cat-like pointy ears + tiny clover leaf on head */}
          <path
            d="M28 40 L24 18 L46 30 Z"
            fill={earFill}
            stroke={ink}
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          <path
            d="M92 40 L96 18 L74 30 Z"
            fill={earFill}
            stroke={ink}
            strokeWidth="2.8"
            strokeLinejoin="round"
          />
          {/* Lucky head sprout */}
          <path d="M60 24 Q60 14 66 11" stroke="#4D9E5D" strokeWidth="2.4" strokeLinecap="round" />
          <ellipse cx="69" cy="11" rx="5" ry="3.2" transform="rotate(-15 69 11)" fill="#6EC277" stroke={ink} strokeWidth="1.8" />
        </g>
      )}

      {variant === 'bramble' && (
        <g>
          <circle cx="32" cy="30" r="11" fill={earFill} stroke={ink} strokeWidth="2.8" />
          <circle cx="32" cy="30" r="5.5" fill="#D5A162" />
          <circle cx="88" cy="30" r="11" fill={earFill} stroke={ink} strokeWidth="2.8" />
          <circle cx="88" cy="30" r="5.5" fill="#D5A162" />
        </g>
      )}

      {/* Plump chubby body-head */}
      <path
        d="M24 68 C24 38 38 24 60 24 C82 24 96 38 96 68 C96 92 84 104 60 104 C36 104 24 92 24 68 Z"
        fill={bodyFill}
        stroke={ink}
        strokeWidth="3"
      />

      {/* Pip's cute forehead tuft */}
      {variant === 'pip' && (
        <path
          d="M52 26 Q56 33 60 27 Q64 33 68 26"
          stroke={ink}
          strokeWidth="2.2"
          strokeLinecap="round"
          fill="none"
        />
      )}

      {/* Bramble's little explorer satchel strap */}
      {variant === 'bramble' && (
        <g>
          <path d="M32 76 L88 94" stroke="#9C6B3B" strokeWidth="4" strokeLinecap="round" />
          <rect x="73" y="83" width="14" height="12" rx="3" fill="#C2884E" stroke={ink} strokeWidth="2" />
        </g>
      )}

      {/* Left & Right Arms (raised when celebrating!) */}
      {isHappy ? (
        <g>
          <path
            d="M25 66 C14 56 12 45 19 42 C24 40 27 50 28 58"
            fill={bodyFill}
            stroke={ink}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <path
            d="M95 66 C106 56 108 45 101 42 C96 40 93 50 92 58"
            fill={bodyFill}
            stroke={ink}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        </g>
      ) : (
        <g>
          <path
            d="M25 70 C17 72 16 82 24 83"
            fill={bodyFill}
            stroke={ink}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
          <path
            d="M95 70 C103 72 104 82 96 83"
            fill={bodyFill}
            stroke={ink}
            strokeWidth="2.8"
            strokeLinecap="round"
          />
        </g>
      )}

      {/* Little feet */}
      <ellipse cx="46" cy="104" rx="8" ry="5" fill={bodyFill} stroke={ink} strokeWidth="2.8" />
      <ellipse cx="74" cy="104" rx="8" ry="5" fill={bodyFill} stroke={ink} strokeWidth="2.8" />

      {/* Rosy cheeks */}
      <ellipse cx="38" cy="67" rx="7.5" ry="4.5" fill={cheekFill} opacity="0.72" />
      <ellipse cx="82" cy="67" rx="7.5" ry="4.5" fill={cheekFill} opacity="0.72" />

      {/* Expressive Eyes */}
      {mood === 'celebrate_easy' || mood === 'celebrate_mastery' ? (
        <g>
          {/* Sparkle star-happy eyes */}
          <path d="M40 58 L44 52 L48 58 L44 62 Z" fill="#F59E0B" stroke={ink} strokeWidth="1.6" />
          <path d="M72 58 L76 52 L80 58 L76 62 Z" fill="#F59E0B" stroke={ink} strokeWidth="1.6" />
        </g>
      ) : isHappy ? (
        <g>
          {/* Joyful crescent eyes */}
          <path
            d="M39 59 Q44 52 49 59"
            stroke={ink}
            strokeWidth="2.8"
            strokeLinecap="round"
            fill="none"
          />
          <path
            d="M71 59 Q76 52 81 59"
            stroke={ink}
            strokeWidth="2.8"
            strokeLinecap="round"
            fill="none"
          />
        </g>
      ) : mood === 'encourage' ? (
        <g>
          {/* Determined cute > < eyes */}
          <path
            d="M40 54 L47 58 L40 62"
            stroke={ink}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          <path
            d="M80 54 L73 58 L80 62"
            stroke={ink}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
          {/* Tiny sweatdrop */}
          <path
            d="M90 45 C92 48 92 52 89 52 C86 52 86 48 88 45 Z"
            fill="#93C5FD"
            stroke={ink}
            strokeWidth="1.3"
          />
        </g>
      ) : (
        <g>
          {/* Round glossy dot eyes */}
          <circle cx="44" cy="57" r="4.2" fill={ink} />
          <circle cx="42.7" cy="55.5" r="1.4" fill="#FFFFFF" />
          <circle cx="76" cy="57" r="4.2" fill={ink} />
          <circle cx="74.7" cy="55.5" r="1.4" fill="#FFFFFF" />
        </g>
      )}

      {/* Cute mouth */}
      {isHappy ? (
        <path
          d="M54 65 Q57 70 60 66 Q63 70 66 65 Q64 74 60 74 Q56 74 54 65 Z"
          fill="#F48FB1"
          stroke={ink}
          strokeWidth="2.2"
          strokeLinejoin="round"
        />
      ) : mood === 'thinking' ? (
        <g>
          <circle cx="60" cy="68" r="2.6" fill={ink} />
          <text x="98" y="34" fill="#4D9E5D" fontSize="18" fontWeight="bold">
            ?
          </text>
        </g>
      ) : (
        <path
          d="M54 66 Q57 69 60 66 Q63 69 66 66"
          stroke={ink}
          strokeWidth="2.4"
          strokeLinecap="round"
          fill="none"
        />
      )}
    </svg>
  );
}

function CloverParticle() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <circle cx="9" cy="9" r="4.5" fill="#48BB78" />
      <circle cx="15" cy="9" r="4.5" fill="#48BB78" />
      <circle cx="9" cy="15" r="4.5" fill="#38A169" />
      <circle cx="15" cy="15" r="4.5" fill="#38A169" />
      <path d="M12 16 L12 22" stroke="#2F855A" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function StarParticle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="#FBBF24">
      <path d="M12 2 L14.8 8.6 L22 9.3 L16.5 14 L18.2 21 L12 17.3 L5.8 21 L7.5 14 L2 9.3 L9.2 8.6 Z" />
    </svg>
  );
}

function FlowerParticle() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="6" r="3.5" fill="#F9A8D4" />
      <circle cx="18" cy="12" r="3.5" fill="#F9A8D4" />
      <circle cx="12" cy="18" r="3.5" fill="#F9A8D4" />
      <circle cx="6" cy="12" r="3.5" fill="#F9A8D4" />
      <circle cx="12" cy="12" r="3" fill="#FDE047" />
    </svg>
  );
}
