import { useEffect, useState } from 'react';

/**
 * Resolve CSS custom properties for chart rendering.
 *
 * Recharts writes plain SVG attributes, which can't take `var(--token)` in every
 * browser, so the values are read from the computed style once and re-read
 * whenever the `dark` class on `<html>` changes — keeping `theme.css` the single
 * source of truth instead of duplicating hex values into chart components.
 */
export interface ChartColors {
  income: string;
  expense: string;
  accent: string;
  grid: string;
  axis: string;
  surface: string;
  cursor: string;
}

const FALLBACK: ChartColors = {
  income: '#1268a8',
  expense: '#c07a2e',
  accent: '#A8813C',
  grid: '#e9e5db',
  axis: '#a8a294',
  surface: '#fffefb',
  cursor: 'rgba(22,21,15,0.035)',
};

function read(): ChartColors {
  if (typeof window === 'undefined') return FALLBACK;
  const style = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.classList.contains('dark');

  return {
    income: get('--k-chart-income', FALLBACK.income),
    expense: get('--k-chart-expense', FALLBACK.expense),
    accent: get('--k-gold', FALLBACK.accent),
    grid: get('--k-chart-grid', FALLBACK.grid),
    axis: get('--k-chart-axis', FALLBACK.axis),
    surface: get('--k-surface', FALLBACK.surface),
    cursor: dark ? 'rgba(255,255,255,0.04)' : 'rgba(22,21,15,0.035)',
  };
}

export function useChartColors(): ChartColors {
  const [colors, setColors] = useState<ChartColors>(() => read());

  useEffect(() => {
    const update = () => setColors(read());
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  return colors;
}
