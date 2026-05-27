import { useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  type Node as RFNode,
  type Edge as RFEdge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { EngineResult } from '../engine';
import { EntityNode } from './EntityNode';
import { RoutedEdge } from './RoutedEdge';

const nodeTypes = { entity: EntityNode };
const edgeTypes = { routed: RoutedEdge };

interface Props {
  result: EngineResult;
}

const EDGE_COLOR = {
  identifying:    '#58a6ff',
  identifyingISA: '#d2a8ff',
  referential:    '#8b949e',
  span:           '#d29922',
};

export function GraphView({ result }: Props) {
  const { nodes, edges } = useMemo(() => {
    if (!result.model || !result.positions) return { nodes: [] as RFNode[], edges: [] as RFEdge[] };
    const routes = result.edgeRoutes;

    const nodes: RFNode[] = [];
    for (const [name, entity] of result.model.nodes) {
      const pos = result.positions.get(name);
      if (!pos) continue;
      nodes.push({
        id: name,
        type: 'entity',
        position: { x: pos.x, y: pos.y },
        data: { entity },
        draggable: false,
        selectable: true,
      });
    }

    const edges: RFEdge[] = [];
    result.model.edges.forEach((e, i) => {
      const isISA = !!e.clusterRef;
      const color = e.kind === 'identifying'
        ? (isISA ? EDGE_COLOR.identifyingISA : EDGE_COLOR.identifying)
        : EDGE_COLOR.referential;

      const route = routes?.get(i);
      if (!route || route.points.length < 2) return;

      edges.push({
        id: `e${i}`,
        source: e.parent,
        target: e.child,
        type: 'routed',
        data: {
          points: route.points,
          color,
          dashed: e.kind === 'referential',
          label: e.predicate.fwd,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      });
    });

    return { nodes, edges };
  }, [result]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.05}
      maxZoom={3}
      proOptions={{ hideAttribution: true }}
    >
      <Background color="#21262d" gap={24} />
      <Controls />
      <MiniMap
        nodeColor={(n) => {
          const cls = (n.data as any)?.entity?.classification ?? 'independent';
          return ({
            independent: '#58a6ff',
            dependent:   '#a371f7',
            subtype:     '#ff7b72',
            basetype:    '#d2a8ff',
            associative: '#f0883e',
            classifier:  '#3fb950',
          })[cls] ?? '#8b949e';
        }}
        maskColor="rgba(14, 17, 22, 0.85)"
      />
    </ReactFlow>
  );
}
