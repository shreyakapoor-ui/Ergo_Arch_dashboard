interface ConnectionLineProps {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function ConnectionLine({ x1, y1, x2, y2 }: ConnectionLineProps) {
  // Calculate control points for a smooth curve
  const midY = (y1 + y2) / 2;
  
  return (
    <svg className="absolute top-0 left-0 pointer-events-none" style={{ width: '100%', height: '100%', overflow: 'visible' }}>
      <defs>
        <marker
          id="arrowhead"
          markerWidth="10"
          markerHeight="10"
          refX="9"
          refY="3"
          orient="auto"
        >
          <polygon points="0 0, 10 3, 0 6" fill="#9ca3af" />
        </marker>
      </defs>
      <path
        d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
        stroke="#9ca3af"
        strokeWidth="2"
        fill="none"
        markerEnd="url(#arrowhead)"
      />
    </svg>
  );
}
