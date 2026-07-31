import type { SCurveStage } from '../../config/assessmentModel';

/**
 * Maturity S-curve with the client's position marked.
 *
 * The curve is a logistic function, not the data — it's an illustrative
 * backdrop for the stage bands. The marker's x position is the real
 * score; its y position is just the curve at that x.
 */
export function SCurveChart({ score, stages }: { score: number; stages: SCurveStage[] }) {
  const w = 660;
  const h = 190;
  const pad = 36;
  const plotW = w - 2 * pad;
  const plotH = h - 2 * pad;

  const logistic = (x: number) => 1 / (1 + Math.exp(-0.1 * (x - 50)));

  const points: string[] = [];
  for (let x = 0; x <= 100; x += 0.5) {
    points.push(`${pad + (x / 100) * plotW},${h - pad - logistic(x) * plotH}`);
  }

  const clamped = Math.max(0, Math.min(99, score));
  const px = pad + (clamped / 100) * plotW;
  const py = h - pad - logistic(clamped) * plotH;

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      style={{ width: '100%', maxWidth: w }}
      role="img"
      aria-label={`Maturity journey position at ${Math.round(score)} percent`}
    >
      {stages.map((stage) => {
        const x1 = pad + (stage.min / 100) * plotW;
        const x2 = pad + (stage.max / 100) * plotW;
        return (
          <g key={stage.label}>
            <rect
              x={x1}
              y={pad - 16}
              width={x2 - x1}
              height={h - pad + 2 - (pad - 16)}
              fill={stage.color}
              opacity={0.1}
              rx={2}
            />
            <text
              x={(x1 + x2) / 2}
              y={h - 8}
              textAnchor="middle"
              style={{
                fontSize: 8,
                fill: 'var(--ink-3)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.04em'
              }}
            >
              {stage.label}
            </text>
          </g>
        );
      })}

      <path d={`M${points.join(' L')}`} fill="none" stroke="var(--charcoal)" strokeWidth={2} />

      <circle cx={px} cy={py} r={7} fill="var(--orange)" stroke="var(--white)" strokeWidth={2} />
      <text
        x={px}
        y={py - 14}
        textAnchor="middle"
        style={{
          fontSize: 9,
          fontWeight: 700,
          fill: 'var(--orange)',
          fontFamily: 'var(--font-mono)',
          letterSpacing: '0.08em'
        }}
      >
        YOU ARE HERE
      </text>
    </svg>
  );
}
