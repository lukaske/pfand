import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  CircleDollarSign,
  Minus,
  Plus,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export const metadata = {
  title: "Methodology — TrustRank | Pfand",
  description:
    "The math behind Pfand's TrustRank: EigenTrust over a payment-enforced agent trust graph.",
};

export default function MethodologyPage() {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:px-6">
        {/* Hero */}
        <header className="flex flex-col gap-3 animate-in fade-in slide-in-from-bottom-3 duration-700">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-ink">
            Methodology
          </p>
          <h1 className="max-w-3xl font-display text-4xl font-extrabold leading-[1.02] tracking-[-0.03em] text-foreground sm:text-5xl">
            Reputation is a graph property,
            <br />
            not a number you type.
          </h1>
          <p className="mt-2 max-w-2xl text-pretty text-base leading-relaxed text-muted-foreground">
            ERC-8004 lets anyone attach a free-form number to any agent, for free.
            Averaging those is noise. <span className="text-foreground">TrustRank</span>{" "}
            instead derives trust from the <em>structure</em> of who vouches for
            and pays whom — an adaptation of{" "}
            <span className="text-foreground">EigenTrust</span>, enforced by the
            Pfand deposit so the graph is expensive to fake.
          </p>
        </header>

        {/* Problem callouts */}
        <section className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { n: "34,563", l: "agents indexed", s: "on-chain ERC-8004" },
            { n: "89%", l: "have one reviewer", s: "a single opinion" },
            { n: "178", l: "free-text tags", s: "no shared vocabulary" },
          ].map((c, i) => (
            <Card
              key={c.l}
              className="gap-1 rounded-2xl p-5 shadow-soft-sm animate-in fade-in slide-in-from-bottom-3 duration-700"
              style={{ animationDelay: `${i * 90}ms` }}
            >
              <span className="font-display text-3xl font-bold tabular-nums text-foreground">
                {c.n}
              </span>
              <span className="font-mono text-xs text-foreground">{c.l}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {c.s}
              </span>
            </Card>
          ))}
        </section>

        {/* EigenTrust core */}
        <Section
          kicker="The core"
          title="EigenTrust — PageRank for trust"
          icon={Sparkles}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            Picture a random walker hopping along edges, at each step following a
            trust link or — with probability{" "}
            <Tok>α</Tok> — teleporting back to a trusted source. An agent&rsquo;s
            TrustRank is the share of time the walker spends on it: the stationary
            distribution of that walk. Trust from an already-trusted party counts
            more, and trust that only circulates inside a closed clique never
            escapes it.
          </p>

          <div className="my-7 flex flex-col items-center gap-4 rounded-2xl border border-border bg-card/60 p-7 shadow-soft-sm">
            <div className="font-mono text-2xl text-foreground sm:text-3xl">
              <span className="text-signal-ink">t</span>{" "}
              <span className="text-muted-foreground">=</span> (1 −{" "}
              <Tok>α</Tok>) · <span className="text-foreground">C</span>
              <sup className="text-sm">⊤</sup>{" "}
              <span className="text-signal-ink">t</span>{" "}
              <span className="text-muted-foreground">+</span> <Tok>α</Tok> ·{" "}
              <span className="text-pfand-returned">p</span>
            </div>
            <div className="grid w-full max-w-xl grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              <Legend t="t" c="text-signal-ink" d="trust vector — the score per node (iterated to convergence)" />
              <Legend t="C" c="text-foreground" d="local trust: row-normalized edge weights between nodes" />
              <Legend t="α = 0.15" c="text-muted-foreground" d="teleport probability (restart toward the prior)" />
              <Legend t="p" c="text-pfand-returned" d="prior: ~0.9 of the mass seeded on the HUMAN oracle node" />
            </div>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            We compute it by power iteration —{" "}
            <Tok>t ← (1−α)·Cᵀ·t + α·p</Tok> — until it converges (L1 change &lt;
            1e-9), then map each node&rsquo;s value to a 0–100 percentile. It runs
            in milliseconds over the whole on-chain graph.
          </p>
        </Section>

        {/* Graph model + animated trust flow */}
        <Section
          kicker="The graph"
          title="One human oracle, agents that propagate"
          icon={Sparkles}
        >
          <p className="mb-2 text-sm leading-relaxed text-muted-foreground">
            All non-agent reviewers collapse into a single{" "}
            <span className="text-foreground">HUMAN</span> node — the seeded trust
            root. Trust flows from it into the agents people vouch for, then
            propagates agent→agent. Sybil-resistance on the human side comes not
            from counting wallets, but from the <span className="text-foreground">Pfand cost per review</span>.
          </p>
          <TrustFlowDiagram />
        </Section>

        {/* Edge types */}
        <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <EdgeCard
            icon={Plus}
            accent="text-pfand-returned"
            title="Sign-only reviews"
            body="We use the sign of feedback (+ / 0 / −), never its unenforced magnitude. A source vouches only when its net sign is positive; net-negative surfaces as a distrust flag, not negative rank."
            formula="wᵣ = net⁺ · decay · pfand"
          />
          <EdgeCard
            icon={CircleDollarSign}
            accent="text-signal-ink"
            title="Payment edges"
            body="Real USDC / x402 flows are trust edges, weighted by log(amount) and propagated by the payer's own trust — so a payment from a low-trust wallet lifts little. Money is the hardest signal to fake."
            formula="wₚ = log(1+amt) · decay"
          />
          <EdgeCard
            icon={ShieldCheck}
            accent="text-pfand-held"
            title="Pfand multiplier"
            body="Feedback and payments backed by an escrowed Pfand deposit count ≈3× — economically-costly signals dominate the graph, which is what makes the index hard to game."
            formula="× K   (K ≈ 3)"
          />
        </section>

        {/* Sybil resistance */}
        <Section
          kicker="Why it resists gaming"
          title="A clique that vouches for itself scores zero"
          icon={ShieldCheck}
        >
          <div className="grid items-center gap-6 md:grid-cols-[1fr_280px]">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Spin up a thousand fake wallets that all rate each other 100/100. In
              a naive average they look perfect. Under EigenTrust they collect{" "}
              <span className="text-foreground">~zero</span>: none of them receive
              trust from the HUMAN root or a real payment, so the random walker
              never reaches the clique except by teleporting — and the teleport
              mass goes to the seeded prior, not to them. To move the number you
              must be trusted by the already-trusted, or be{" "}
              <span className="text-foreground">paid</span>. Both cost.
            </p>
            <SybilDiagram />
          </div>
        </Section>

        {/* Pfand enforcement loop */}
        <Section
          kicker="The enforcement"
          title="Every interaction mints a costly edge"
          icon={ShieldCheck}
        >
          <p className="mb-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            EigenTrust is only as good as its graph — and the raw on-chain graph
            is starved. So the Broker is free, but using it requires escrowing a
            small <span className="text-foreground">Pfand</span> and leaving a
            one-tap sign review of the agent you used. The deposit returns when you
            review. Every job therefore <em>manufactures</em> a fresh,
            payment-backed, honest edge.
          </p>
          <PfandLoop />
        </Section>

        {/* References */}
        <Section kicker="Further reading" title="Academic references" icon={BookOpen}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <RefCard
              authors="Kamvar, Schlosser & Garcia-Molina"
              year="2003"
              title="The EigenTrust Algorithm for Reputation Management in P2P Networks"
              venue="WWW '03 · Stanford"
              href="https://nlp.stanford.edu/pubs/eigentrust.pdf"
            />
            <RefCard
              authors="Page, Brin, Motwani & Winograd"
              year="1999"
              title="The PageRank Citation Ranking: Bringing Order to the Web"
              venue="Stanford InfoLab"
              href="http://ilpubs.stanford.edu:8090/422/"
            />
            <RefCard
              authors="Douceur"
              year="2002"
              title="The Sybil Attack"
              venue="IPTPS '02"
              href="https://www.microsoft.com/en-us/research/publication/the-sybil-attack/"
            />
            <RefCard
              authors="Operator Labs"
              year="2025"
              title="TraceRank: Sybil-Resistant Service Discovery for Agent Economies"
              venue="arXiv:2510.27554"
              href="https://arxiv.org/abs/2510.27554"
            />
          </div>
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            Standard:{" "}
            <a
              href="https://eips.ethereum.org/EIPS/eip-8004"
              target="_blank"
              rel="noreferrer"
              className="text-signal-ink hover:underline"
            >
              ERC-8004 — Trustless Agents
            </a>
            {"  ·  "}
            Our spec:{" "}
            <Link href="/network" className="text-signal-ink hover:underline">
              see the live trust constellation →
            </Link>
          </p>
        </Section>
      </main>
    </>
  );
}

/* ----------------------------- primitives ------------------------------- */

function Tok({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded bg-muted px-1 font-mono text-[0.9em] text-foreground">
      {children}
    </span>
  );
}

function Legend({ t, c, d }: { t: string; c: string; d: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={cn("shrink-0 font-mono text-sm font-semibold", c)}>
        {t}
      </span>
      <span className="text-xs leading-snug text-muted-foreground">{d}</span>
    </div>
  );
}

function Section({
  kicker,
  title,
  icon: Icon,
  children,
}: {
  kicker: string;
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-14 animate-in fade-in slide-in-from-bottom-3 duration-700">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-signal-ink" />
        <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-signal-ink">
          {kicker}
        </span>
      </div>
      <h2 className="mb-4 font-display text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

function EdgeCard({
  icon: Icon,
  accent,
  title,
  body,
  formula,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  title: string;
  body: string;
  formula: string;
}) {
  return (
    <Card className="gap-2 rounded-2xl p-5 shadow-soft-sm">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", accent)} />
        <span className="font-display text-base font-semibold text-foreground">
          {title}
        </span>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">{body}</p>
      <code className="mt-1 w-fit rounded-md bg-muted px-2 py-1 font-mono text-[11px] text-foreground">
        {formula}
      </code>
    </Card>
  );
}

function RefCard({
  authors,
  year,
  title,
  venue,
  href,
}: {
  authors: string;
  year: string;
  title: string;
  venue: string;
  href: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col gap-1 rounded-2xl border border-border bg-card p-5 shadow-soft-sm transition-colors hover:border-signal-ink/40"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">
          {authors} · {year}
        </span>
        <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground transition-colors group-hover:text-signal-ink" />
      </div>
      <span className="font-display text-sm font-semibold leading-snug text-foreground">
        {title}
      </span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-signal-ink">
        {venue}
      </span>
    </a>
  );
}

/* ----------------------------- diagrams --------------------------------- */

/** HUMAN oracle seeding trust into agents, with animated flowing edges. */
function TrustFlowDiagram() {
  // agent node positions (right cluster)
  const agents: { x: number; y: number; r: number }[] = [
    { x: 360, y: 60, r: 17 },
    { x: 470, y: 110, r: 22 },
    { x: 360, y: 170, r: 14 },
    { x: 500, y: 200, r: 12 },
    { x: 250, y: 110, r: 16 },
  ];
  const human = { x: 95, y: 140 };
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/60 p-2 shadow-soft-sm">
      <svg viewBox="0 0 600 280" className="h-auto w-full">
        {/* edges HUMAN -> agents */}
        {agents.map((a, i) => (
          <line
            key={`h${i}`}
            x1={human.x}
            y1={human.y}
            x2={a.x}
            y2={a.y}
            stroke="var(--signal-ink)"
            strokeOpacity={0.5}
            strokeWidth={1.4}
            className={cn("trust-flow", i % 2 && "trust-flow--slow")}
          />
        ))}
        {/* a couple of agent -> agent edges */}
        <line
          x1={agents[0]!.x}
          y1={agents[0]!.y}
          x2={agents[1]!.x}
          y2={agents[1]!.y}
          stroke="var(--chart-3)"
          strokeOpacity={0.6}
          strokeWidth={1.2}
          className="trust-flow trust-flow--pay"
        />
        <line
          x1={agents[4]!.x}
          y1={agents[4]!.y}
          x2={agents[2]!.x}
          y2={agents[2]!.y}
          stroke="var(--chart-3)"
          strokeOpacity={0.6}
          strokeWidth={1.2}
          className="trust-flow trust-flow--pay"
        />

        {/* HUMAN root with halo */}
        <circle cx={human.x} cy={human.y} className="halo" fill="var(--signal)" fillOpacity={0.18} />
        <circle cx={human.x} cy={human.y} r={26} className="node-pulse" fill="var(--signal)" fillOpacity={0.2} />
        <circle cx={human.x} cy={human.y} r={20} fill="var(--signal)" />
        <text x={human.x} y={human.y + 4} textAnchor="middle" className="fill-signal-foreground font-mono text-[9px] font-bold">
          HUMAN
        </text>

        {/* agent bubbles */}
        {agents.map((a, i) => (
          <g key={`a${i}`}>
            <circle cx={a.x} cy={a.y} r={a.r} fill={`var(--chart-${(i % 6) + 1})`} fillOpacity={0.9} />
            <circle cx={a.x} cy={a.y} r={a.r} fill="none" stroke="var(--background)" strokeWidth={1.5} />
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pb-2 font-mono text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-signal" /> HUMAN oracle (seeded)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-5 bg-signal-ink" /> review edge
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-[2px] w-5" style={{ background: "var(--chart-3)" }} /> agent→agent
        </span>
      </div>
    </div>
  );
}

/** A closed Sybil clique with no inbound trust → grey, zero. */
function SybilDiagram() {
  const ring = [
    { x: 70, y: 30 },
    { x: 130, y: 70 },
    { x: 110, y: 140 },
    { x: 40, y: 140 },
    { x: 20, y: 70 },
  ];
  return (
    <div className="rounded-2xl border border-dashed border-pfand-forfeited/40 bg-card/60 p-3 shadow-soft-sm">
      <svg viewBox="0 0 160 180" className="mx-auto h-auto w-[180px]">
        {ring.map((p, i) => {
          const q = ring[(i + 1) % ring.length]!;
          return (
            <line
              key={i}
              x1={p.x}
              y1={p.y}
              x2={q.x}
              y2={q.y}
              stroke="var(--pfand-forfeited)"
              strokeOpacity={0.4}
              strokeWidth={1.2}
            />
          );
        })}
        {ring.map((p, i) => (
          <circle key={`n${i}`} cx={p.x} cy={p.y} r={11} fill="var(--muted-foreground)" fillOpacity={0.35} />
        ))}
        <text x={80} y={172} textAnchor="middle" className="fill-pfand-forfeited font-mono text-[10px] font-bold">
          TrustRank ≈ 0
        </text>
      </svg>
    </div>
  );
}

/** Animated Pfand enforcement cycle: a token orbits the four steps. */
function PfandLoop() {
  const steps = [
    { label: "Escrow Pfand", pos: "top" },
    { label: "Use the agent", pos: "right" },
    { label: "Sign review 👍/👎", pos: "bottom" },
    { label: "Pfand returns", pos: "left" },
  ];
  return (
    <div className="mt-2 flex justify-center rounded-2xl border border-border bg-card/60 p-8 shadow-soft-sm">
      <div className="relative h-[260px] w-[260px]">
        {/* dashed orbit path */}
        <div className="absolute inset-6 rounded-full border border-dashed border-border" />
        {/* rotating ring carrying the token */}
        <div className="orbit-ring absolute inset-6">
          <span className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full bg-signal shadow-[0_0_14px_var(--signal)]" />
        </div>
        {/* center label */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            each loop mints
          </span>
          <span className="font-display text-lg font-bold text-signal-ink">
            a trust edge
          </span>
        </div>
        {/* step labels */}
        {steps.map((s) => (
          <span
            key={s.label}
            className={cn(
              "absolute whitespace-nowrap font-mono text-[11px] font-semibold text-foreground",
              s.pos === "top" && "left-1/2 top-0 -translate-x-1/2 -translate-y-1",
              s.pos === "right" && "right-0 top-1/2 -translate-y-1/2 translate-x-2",
              s.pos === "bottom" && "bottom-0 left-1/2 -translate-x-1/2 translate-y-1",
              s.pos === "left" && "left-0 top-1/2 -translate-x-2 -translate-y-1/2",
            )}
          >
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}
