import type { ReactNode } from 'react';

/**
 * A screen-reader equivalent for a chart (§Phase 16).
 *
 * An SVG chart is a picture: its axis ticks are read as loose numbers and its data
 * points are not reachable at all. This renders the same points as a real table that
 * is visually hidden, and the chart it accompanies is hidden from assistive
 * technology (`aria-hidden`) so nothing is announced twice. Values arrive already
 * formatted by the caller, so privacy mode can mask them exactly as it masks the chart.
 */
export function ChartTextAlternative({
  caption,
  columns,
  rows,
}: {
  caption: string;
  columns: [string, string];
  rows: Array<[ReactNode, ReactNode]>;
}) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          <th scope="col">{columns[0]}</th>
          <th scope="col">{columns[1]}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([label, value], index) => (
          <tr key={index}>
            <th scope="row">{label}</th>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
