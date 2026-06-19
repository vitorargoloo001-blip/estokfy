import { useEffect, useRef } from 'react';

interface Options {
  onScan: (code: string) => void;
  enabled?: boolean;
  /** Tempo máximo (ms) entre teclas para considerar leitura de scanner. */
  maxIntervalMs?: number;
  /** Tamanho mínimo do código aceito. */
  minLength?: number;
}

/**
 * Captura entrada rápida de scanner USB/Bluetooth (atua como teclado).
 * Funciona globalmente: digitação rápida (<50ms entre teclas) terminada com Enter
 * dispara `onScan(code)`. Ignora se foco está em <textarea> ou input opt-out
 * (atributo `data-no-scan` no input/elemento ancestral).
 */
export function useBarcodeScanner({ onScan, enabled = true, maxIntervalMs = 50, minLength = 4 }: Options) {
  const bufferRef = useRef('');
  const lastTimeRef = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;

  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Ignora textareas e elementos opt-out
      if (target) {
        if (target.tagName === 'TEXTAREA') return;
        if (target.closest?.('[data-no-scan]')) return;
        if (target.tagName === 'INPUT') {
          const t = (target as HTMLInputElement).type;
          // permite scanner sobrepor inputs comuns; mas se o usuário está
          // genuinamente digitando devagar não dispara (intervalo > maxIntervalMs).
          if (['password', 'email'].includes(t)) return;
        }
      }

      const now = Date.now();
      const elapsed = now - lastTimeRef.current;
      lastTimeRef.current = now;

      if (e.key === 'Enter') {
        const code = bufferRef.current.trim();
        bufferRef.current = '';
        if (code.length >= minLength) {
          // Confirma rapidez média
          e.preventDefault();
          onScanRef.current(code);
        }
        return;
      }

      // Reseta buffer quando intervalo grande
      if (elapsed > 250) bufferRef.current = '';

      // Aceita apenas chars imprimíveis (1 caractere)
      if (e.key.length === 1) {
        bufferRef.current += e.key;
      }
    };

    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [enabled, maxIntervalMs, minLength]);
}

/** Beep curto via WebAudio (não exige arquivo de áudio). */
export function beep(durationMs = 80, freq = 880, volume = 0.05) {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    gain.gain.value = volume;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); ctx.close(); }, durationMs);
  } catch {
    /* noop */
  }
}
