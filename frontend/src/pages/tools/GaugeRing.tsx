/** Circular score gauge. Pure SVG — no animation library, no layout shift. */
export function GaugeRing({
  score,
  size,
  stroke,
  colour
}: {
  score: number;
  size: number;
  stroke: number;
  colour: string;
}) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.max(0, Math.min(100, score)) / 100) * circumference;

  return (
    <svg
      width={size}
      height={size}
      role="img"
      aria-label={`Overall maturity ${Math.round(score)} percent`}
      style={{ display: 'block' }}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="var(--rule)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={colour}
        strokeWidth={stroke}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
      />
      <text
        x={size / 2}
        y={size / 2 + 1}
        textAnchor="middle"
        dominantBaseline="middle"
        style={{
          fontSize: size * 0.27,
          fontWeight: 800,
          fill: 'var(--ink)',
          fontFamily: 'var(--font-display)'
        }}
      >
        {Math.round(score)}%
      </text>
    </svg>
  );
}
