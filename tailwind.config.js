/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        pit: {
          bg: '#070B14',
          surface: '#0D1424',
          card: '#111B30',
          line: '#1F2A44',
          ink: '#E2E8F0',
          mute: '#94A3B8',
          dim: '#64748B',
          road: '#0F172A',
          signal: '#FB923C',
          signalHi: '#FDBA74',
          signalDeep: '#EA580C',
          cyan: '#22D3EE',
          safe: '#22C55E',
          warn: '#FACC15',
          danger: '#EF4444'
        }
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace']
      },
      boxShadow: {
        panel: '0 18px 45px rgba(0, 0, 0, 0.45)',
        glow: '0 0 0 1px rgba(251, 146, 60, 0.35), 0 0 32px -4px rgba(251, 146, 60, 0.45)',
        glowCyan: '0 0 0 1px rgba(34, 211, 238, 0.35), 0 0 32px -4px rgba(34, 211, 238, 0.35)',
        inset: 'inset 0 1px 0 0 rgba(255,255,255,0.06)'
      },
      backgroundImage: {
        'grid-fade':
          'radial-gradient(circle at 50% 0%, rgba(251,146,60,0.10), transparent 55%), linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
        stripes: 'repeating-linear-gradient(135deg, rgba(251,146,60,0.18) 0 14px, transparent 14px 28px)',
        checker: 'repeating-conic-gradient(#0D1424 0% 25%, #111B30 0% 50%)'
      },
      backgroundSize: {
        grid: '100% 100%, 40px 40px, 40px 40px',
        checker: '18px 18px'
      },
      animation: {
        'pulse-glow': 'pulse-glow 2.4s ease-in-out infinite',
        'fade-up': 'fade-up 0.45s ease-out both',
        blink: 'blink 1.4s ease-in-out infinite'
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(251,146,60,0.45)' },
          '50%': { boxShadow: '0 0 0 12px rgba(251,146,60,0)' }
        },
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' }
        }
      },
      borderRadius: {
        xl2: '1.25rem'
      }
    }
  },
  plugins: []
};
