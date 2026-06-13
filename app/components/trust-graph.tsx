"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  forceSimulation,
  forceManyBody,
  forceCollide,
  forceX,
  forceY,
  forceLink,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from "d3-force";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { NetworkNode, NetworkEdge } from "@/lib/api";

/* The 6 categorical chart tokens, cycled so each task gets a stable color. */
const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
] as const;

const WIDTH = 960;
const HEIGHT = 620;
const TICKS = 300;
const R_MIN = 6;
const R_MAX = 34;

/** Stable task → color map. Cycles --chart-1..6 by first-seen order. */
export function buildTaskColors(tasks: string[]): Map<string, string> {
  const m = new Map<string, string>();
  tasks.forEach((t, i) => m.set(t, CHART_VARS[i % CHART_VARS.length]));
  return m;
}

type SimNode = SimulationNodeDatum & {
  node: NetworkNode;
  r: number;
  color: string;
  cx: number;
  cy: number;
};

type SimLink = SimulationLinkDatum<SimNode> & { weight: number };

function radiusScale(raw: number | null, maxRaw: number): number {
  if (!raw || maxRaw <= 0) return R_MIN;
  // area ∝ trustRankRaw → radius ∝ sqrt(raw).
  const t = Math.sqrt(raw) / Math.sqrt(maxRaw);
  return R_MIN + t * (R_MAX - R_MIN);
}

/** Cluster centers, one per distinct topTask, laid out on a circle. */
function clusterCenters(topTasks: string[]): Map<string, [number, number]> {
  const m = new Map<string, [number, number]>();
  const n = topTasks.length;
  if (n === 0) return m;
  if (n === 1) {
    m.set(topTasks[0], [WIDTH / 2, HEIGHT / 2]);
    return m;
  }
  const rx = WIDTH * 0.32;
  const ry = HEIGHT * 0.32;
  topTasks.forEach((t, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    m.set(t, [WIDTH / 2 + Math.cos(a) * rx, HEIGHT / 2 + Math.sin(a) * ry]);
  });
  return m;
}

export function TrustGraph({
  nodes,
  edges,
}: {
  nodes: NetworkNode[];
  edges: NetworkEdge[];
}) {
  const router = useRouter();

  const { sim, links } = useMemo(() => {
    if (nodes.length === 0)
      return { sim: [] as SimNode[], links: [] as { x1: number; y1: number; x2: number; y2: number; weight: number }[] };

    const maxRaw = Math.max(
      ...nodes.map((n) => n.trustRankRaw ?? 0),
      Number.EPSILON,
    );

    // Distinct topTasks → stable colors + cluster centers.
    const distinctTasks: string[] = [];
    for (const n of nodes) {
      const t = n.topTask ?? "—";
      if (!distinctTasks.includes(t)) distinctTasks.push(t);
    }
    const colors = buildTaskColors(distinctTasks);
    const centers = clusterCenters(distinctTasks);
    const maxWeight = Math.max(...edges.map((e) => e.weight), Number.EPSILON);

    const simNodes: SimNode[] = nodes.map((node) => {
      const key = node.topTask ?? "—";
      const [cx, cy] = centers.get(key) ?? [WIDTH / 2, HEIGHT / 2];
      return {
        node,
        r: radiusScale(node.trustRankRaw, maxRaw),
        color: colors.get(key) ?? CHART_VARS[0],
        cx,
        cy,
        x: cx + (Math.random() - 0.5) * 40,
        y: cy + (Math.random() - 0.5) * 40,
      };
    });

    const byId = new Map(simNodes.map((s) => [s.node.id, s]));
    const simLinks: SimLink[] = edges
      .filter((e) => byId.has(e.source) && byId.has(e.target))
      .map((e) => ({
        source: byId.get(e.source)!,
        target: byId.get(e.target)!,
        weight: e.weight,
      }));

    const simulation = forceSimulation(simNodes)
      .force("charge", forceManyBody().strength(-140))
      .force(
        "collide",
        forceCollide<SimNode>().radius((d) => d.r + 4).strength(0.9),
      )
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.node.id)
          .distance(70)
          .strength(0.05),
      )
      .force("x", forceX<SimNode>((d) => d.cx).strength(0.14))
      .force("y", forceY<SimNode>((d) => d.cy).strength(0.14))
      .stop();

    simulation.tick(TICKS);

    const links = simLinks.map((l) => {
      const s = l.source as SimNode;
      const t = l.target as SimNode;
      return {
        x1: s.x ?? 0,
        y1: s.y ?? 0,
        x2: t.x ?? 0,
        y2: t.y ?? 0,
        weight: l.weight / maxWeight,
      };
    });

    return { sim: simNodes, links };
  }, [nodes, edges]);

  if (nodes.length === 0) {
    return (
      <div className="flex h-[420px] items-center justify-center rounded-2xl border border-dashed border-border">
        <p className="font-mono text-xs text-muted-foreground">
          No rated agents to constellate yet.
        </p>
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="Trust constellation of agents"
    >
      {/* edges */}
      <g>
        {links.map((l, i) => (
          <line
            key={i}
            x1={l.x1}
            y1={l.y1}
            x2={l.x2}
            y2={l.y2}
            stroke="var(--signal-ink)"
            strokeWidth={0.75 + l.weight * 1.5}
            strokeOpacity={0.08 + l.weight * 0.32}
          />
        ))}
      </g>

      {/* nodes */}
      <g>
        {sim.map((s) => (
          <Tooltip key={s.node.id}>
            <TooltipTrigger asChild>
              <circle
                cx={s.x ?? 0}
                cy={s.y ?? 0}
                r={s.r}
                fill={s.color}
                fillOpacity={0.82}
                stroke="var(--card)"
                strokeWidth={1.5}
                className="cursor-pointer transition-[fill-opacity] hover:fill-opacity-100"
                onClick={() => router.push(`/agent/${s.node.agentId}`)}
              />
            </TooltipTrigger>
            <TooltipContent className="font-mono text-[11px]">
              <div className="font-display text-xs font-semibold text-background">
                {s.node.name}
              </div>
              <div className="text-background/70">
                TrustRank {s.node.trustRank ?? "—"}
                {s.node.taskScore != null
                  ? ` · task ${Math.round(s.node.taskScore)}`
                  : ""}
              </div>
              {s.node.topTask && (
                <div className="text-background/70">{s.node.topTask}</div>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </g>
    </svg>
  );
}

export default TrustGraph;
