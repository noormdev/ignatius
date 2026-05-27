import { BaseEdge, EdgeLabelRenderer, type EdgeProps } from '@xyflow/react';

interface RoutedEdgeData {
  points: Array<{ x: number; y: number }>;
  color: string;
  dashed?: boolean;
  arrow?: boolean;
  label?: string;
}

function pointsToPath(pts: Array<{ x: number; y: number }>): string {
  if (pts.length === 0) return '';
  let d = `M ${pts[0]!.x} ${pts[0]!.y}`;
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i]!.x} ${pts[i]!.y}`;
  return d;
}

export function RoutedEdge({ id, data, markerEnd }: EdgeProps<RoutedEdgeData>) {
  const d = data;
  if (!d || !d.points || d.points.length < 2) return null;

  const path = pointsToPath(d.points);
  const mid = d.points[Math.floor(d.points.length / 2)]!;
  const labelX = mid.x;
  const labelY = mid.y;

  return (
    <>
      <BaseEdge
        id={id}
        path={path}
        markerEnd={markerEnd}
        style={{
          stroke: d.color,
          strokeWidth: 1.5,
          strokeDasharray: d.dashed ? '5 4' : undefined,
          fill: 'none',
        }}
      />
      {d.label && (
        <EdgeLabelRenderer>
          <div
            className="edge-label"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -100%) translate(${labelX}px, ${labelY}px)`,
              color: '#c9d1d9',
              background: 'rgba(14,17,22,0.92)',
              border: '1px solid #30363d',
              padding: '1px 5px',
              borderRadius: 3,
              fontSize: 10,
              whiteSpace: 'nowrap',
              pointerEvents: 'none',
            }}
          >
            {d.label}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
