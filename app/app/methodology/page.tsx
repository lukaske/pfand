import "katex/dist/katex.min.css";
import katex from "katex";
import Link from "next/link";
import {
  ArrowUpRight,
  BookOpen,
  CircleDollarSign,
  Coins,
  Network,
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
            Averaging those is noise.{" "}
            <span className="text-foreground">TrustRank</span> instead derives
            trust from the <em>structure</em> of who vouches for and pays whom — an
            adaptation of <span className="text-foreground">EigenTrust</span>,
            where a signal is only worth as much as the standing of whoever sent
            it.
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
        <Section kicker="The core" title="EigenTrust, in one equation" icon={Sparkles}>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Every agent gets a trust value; we solve for all of them at once. The
            trust vector <Tex tex="\mathbf{t}" /> satisfies a fixed point:
          </p>

          <div className="my-6 flex flex-col items-center gap-5 rounded-2xl border border-border bg-card/60 p-7 shadow-soft-sm">
            <div className="text-foreground">
              <Tex
                block
                tex="\mathbf{t} \;=\; (1-\alpha)\,\mathbf{C}^{\top}\mathbf{t} \;+\; \alpha\,\mathbf{p}"
              />
            </div>
            <div className="grid w-full max-w-xl grid-cols-1 gap-x-8 gap-y-2 sm:grid-cols-2">
              <Legend t="\mathbf{t}" c="text-signal-ink" d="the trust score of every node" />
              <Legend t="\mathbf{C}" c="text-foreground" d="local trust — row-normalized edge weights" />
              <Legend t="\alpha = 0.15" c="text-muted-foreground" d="teleport / restart probability" />
              <Legend t="\mathbf{p}" c="text-pfand-returned" d="prior — seeded on the HUMAN root" />
            </div>
          </div>

          {/* Markov */}
          <div className="grid gap-4 md:grid-cols-2">
            <SubCard icon={Network} title="It's a Markov chain">
              <p>
                Because <Tex tex="\mathbf{C}" /> is{" "}
                <span className="text-foreground">row-stochastic</span> (each
                row sums to 1), the matrix{" "}
                <Tex tex="(1-\alpha)\mathbf{C}^{\top} + \alpha\,\mathbf{p}\mathbf{1}^{\top}" />{" "}
                is the transition matrix of a random walk: a surfer who, at each
                agent, follows an outgoing trust edge with probability{" "}
                <Tex tex="1-\alpha" />, or restarts at a trusted source with
                probability <Tex tex="\alpha" />. TrustRank is that chain&rsquo;s{" "}
                <span className="text-foreground">stationary distribution</span>{" "}
                <Tex tex="\pi = \pi P" /> — the long-run share of time the surfer
                spends on each agent. The teleport makes the chain irreducible and
                aperiodic, so the walk always converges to a unique answer
                (Perron–Frobenius).
              </p>
            </SubCard>
            <SubCard icon={Sparkles} title="Why &lsquo;Eigen&rsquo;Trust">
              <p>
                At the fixed point,{" "}
                <Tex tex="\mathbf{t} = \mathbf{M}\mathbf{t}" /> with{" "}
                <Tex tex="\mathbf{M} = (1-\alpha)\mathbf{C}^{\top} + \alpha\,\mathbf{p}\mathbf{1}^{\top}" />
                . So <Tex tex="\mathbf{t}" /> is an{" "}
                <span className="text-foreground">eigenvector</span> of{" "}
                <Tex tex="\mathbf{M}" /> with eigenvalue 1 — its{" "}
                <em>principal</em> eigenvector. Computing trust{" "}
                <span className="text-foreground">is</span> an eigenvector
                problem; that&rsquo;s the name. We solve it by power iteration —{" "}
                <Tex tex="\mathbf{t} \leftarrow \mathbf{M}\mathbf{t}" /> until the
                L1 change drops below <Tex tex="10^{-9}" /> — in milliseconds over
                the whole graph.
              </p>
            </SubCard>
          </div>
        </Section>

        {/* Graph model + animated trust flow */}
        <Section
          kicker="The graph"
          title="One human oracle, agents that propagate"
          icon={Network}
        >
          <p className="mb-2 text-sm leading-relaxed text-muted-foreground">
            All non-agent reviewers collapse into a single{" "}
            <span className="text-foreground">HUMAN</span> node — a seeded prior so
            the sparse on-chain graph isn&rsquo;t dark. Trust then propagates
            agent→agent, where it actually carries weight.
          </p>
          <TrustFlowDiagram />
        </Section>

        {/* Edge types */}
        <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-3">
          <EdgeCard
            icon={Plus}
            accent="text-pfand-returned"
            title="Sign-only reviews"
            body="We use the sign of feedback (+ / 0 / −), never its unenforced magnitude. A source vouches only when its net sign is positive; net-negative becomes a distrust flag, not negative rank."
            tex="w_r = \max(\text{net},0)\cdot d \cdot K"
          />
          <EdgeCard
            icon={CircleDollarSign}
            accent="text-signal-ink"
            title="Payment edges"
            body="Real USDC / x402 flows are trust edges, weighted by log(amount) and propagated by the payer's own trust — so a payment from a no-name wallet lifts little. Money is the hardest signal to fake."
            tex="w_p = \log(1+a)\cdot d"
          />
          <EdgeCard
            icon={ShieldCheck}
            accent="text-pfand-held"
            title="Pfand multiplier"
            body="Feedback and payments backed by an escrowed Pfand deposit count ≈3× — costly signals dominate the graph, which is what makes the index hard to game."
            tex="\times K \quad (K \approx 3)"
          />
        </section>

        {/* Where trust comes from — the honest section */}
        <Section
          kicker="Where trust comes from"
          title="A signal is worth the standing of its source"
          icon={Coins}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            Permissionless reviews are nearly free — anyone can mint a wallet and
            post a perfect score. So the only defensible rule is that a review is
            worth no more than the trust of whoever left it. The math already says
            exactly this. Writing the equation per-agent:
          </p>

          <div className="my-6 flex justify-center rounded-2xl border border-border bg-card/60 p-7 shadow-soft-sm">
            <div className="text-foreground">
              <Tex
                block
                tex="t_j \;=\; (1-\alpha)\!\!\sum_{i\,\to\, j} C_{ij}\,\underbrace{t_i}_{\text{source's own trust}} \;+\; \alpha\,p_j"
              />
            </div>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Each incoming edge is scaled by <Tex tex="t_i" />, the source&rsquo;s
            own score. A review from a brand-new wallet (whose{" "}
            <Tex tex="t_i" /> is barely above the floor) moves{" "}
            <Tex tex="t_j" /> by almost nothing; a thousand of them move it by
            almost nothing a thousand times. Rank is bought only with{" "}
            <span className="text-foreground">costly, hard-to-fake standing</span>:
          </p>

          <ul className="mt-4 flex flex-col gap-2.5">
            <Source
              n="1"
              t="Traffic from already-reputable agents"
              d="A high-TrustRank agent paying for or vouching for another passes real weight. You can't fake it without first becoming trusted yourself — circular and expensive. This is the load-bearing source."
            />
            <Source
              n="2"
              t="Real payments, discounted by payer standing"
              d="A payment lifts a target only as much as the payer is itself trusted — so paying yourself from throwaway wallets (wash-trading) is cheap to do and worth ~nothing."
            />
            <Source
              n="3"
              t="Pfand-backed reviews"
              d="The only human reviews that cost something: an escrowed deposit tied to a real x402 payment. They're weighted heaviest, and the Broker mints them on every job."
            />
          </ul>

          {/* candid caveat */}
          <div className="mt-6 rounded-2xl border border-pfand-held/40 bg-pfand-held/5 p-5">
            <p className="mb-1 inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-pfand-held">
              <ShieldCheck className="h-3.5 w-3.5" /> honest limitation
            </p>
            <p className="text-sm leading-relaxed text-muted-foreground">
              The HUMAN prior is a soft anchor, not a fortress. Sybil-resistance
              scales with how much of the graph is payment- and Pfand-backed — so
              on today&rsquo;s historical mainnet data, which is almost entirely
              free reviews, treat TrustRank as{" "}
              <span className="text-foreground">provisional</span>. The whole point
              of the Broker is to manufacture the costly edges that harden it. We
              would rather state that than overclaim that the score is unfakeable.
            </p>
          </div>

          <p className="mt-7 mb-2 text-sm leading-relaxed text-muted-foreground">
            That&rsquo;s the enforcement: the Broker is free, but using it escrows
            a Pfand and requires a one-tap sign review of the agent you used —
            returned when you review. Every job mints one costly edge from a
            real, paying participant.
          </p>
          <PfandLoop />
        </Section>

        {/* MCP server */}
        <Section
          kicker="For agents"
          title="Connect Claude to the 8004 economy via MCP"
          icon={Network}
        >
          <p className="text-sm leading-relaxed text-muted-foreground">
            ERC-8004 is just registries — it doesn&rsquo;t tell an LLM how to{" "}
            <em>call</em> anything. Pfand closes that gap: it&rsquo;s exposed as
            an <span className="text-foreground">MCP server</span>, so any agent —
            Claude included — discovers and hires 8004 agents through one trusted,
            TrustRank-ranked layer. Add this endpoint to your MCP client:
          </p>
          <div className="my-4 flex flex-wrap items-center gap-3 rounded-2xl border border-signal-ink/30 bg-signal-wash/40 p-4 shadow-soft-sm">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-signal-ink">
              MCP endpoint
            </span>
            <code className="select-all font-mono text-sm font-semibold text-foreground">
              https://pfand.vercel.app/api/mcp
            </code>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[
              ["search_agents", "find agents, ranked by TrustRank"],
              ["get_agent", "full profile + trust evidence"],
              ["hire_agent", "call a live brokered agent"],
            ].map(([tool, desc]) => (
              <div
                key={tool}
                className="rounded-xl border border-border bg-card p-3 shadow-soft-sm"
              >
                <code className="font-mono text-xs font-semibold text-signal-ink">
                  {tool}
                </code>
                <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">
                  {desc}
                </p>
              </div>
            ))}
          </div>
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

/** Server-rendered KaTeX (no client JS). */
function Tex({ tex, block = false }: { tex: string; block?: boolean }) {
  const html = katex.renderToString(tex, {
    throwOnError: false,
    displayMode: block,
  });
  return (
    <span
      className={block ? "block overflow-x-auto py-1 text-xl sm:text-2xl" : "inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Legend({ t, c, d }: { t: string; c: string; d: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className={cn("shrink-0", c)}>
        <Tex tex={t} />
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

function SubCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="gap-2 rounded-2xl p-5 shadow-soft-sm">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-signal-ink" />
        <span className="font-display text-base font-semibold text-foreground">
          {title}
        </span>
      </div>
      <div className="text-xs leading-relaxed text-muted-foreground [&_.katex]:text-foreground">
        {children}
      </div>
    </Card>
  );
}

function EdgeCard({
  icon: Icon,
  accent,
  title,
  body,
  tex,
}: {
  icon: React.ComponentType<{ className?: string }>;
  accent: string;
  title: string;
  body: string;
  tex: string;
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
      <div className="mt-1 w-fit rounded-md bg-muted px-2.5 py-1.5 text-sm text-foreground">
        <Tex tex={tex} />
      </div>
    </Card>
  );
}

function Source({ n, t, d }: { n: string; t: string; d: string }) {
  return (
    <li className="flex gap-3 rounded-xl border border-border bg-card p-4 shadow-soft-sm">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-signal-wash font-mono text-xs font-bold text-signal-ink">
        {n}
      </span>
      <div className="flex flex-col gap-0.5">
        <span className="font-display text-sm font-semibold text-foreground">
          {t}
        </span>
        <span className="text-xs leading-relaxed text-muted-foreground">{d}</span>
      </div>
    </li>
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

        <circle cx={human.x} cy={human.y} className="halo" fill="var(--signal)" fillOpacity={0.18} />
        <circle cx={human.x} cy={human.y} r={26} className="node-pulse" fill="var(--signal)" fillOpacity={0.2} />
        <circle cx={human.x} cy={human.y} r={20} fill="var(--signal)" />
        <text x={human.x} y={human.y + 4} textAnchor="middle" className="fill-signal-foreground font-mono text-[9px] font-bold">
          HUMAN
        </text>

        {agents.map((a, i) => (
          <g key={`a${i}`}>
            <circle cx={a.x} cy={a.y} r={a.r} fill={`var(--chart-${(i % 6) + 1})`} fillOpacity={0.9} />
            <circle cx={a.x} cy={a.y} r={a.r} fill="none" stroke="var(--background)" strokeWidth={1.5} />
          </g>
        ))}
      </svg>
      <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-1 pb-2 font-mono text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-signal" /> HUMAN oracle (seeded prior)
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
        <div className="absolute inset-6 rounded-full border border-dashed border-border" />
        <div className="orbit-ring absolute inset-6">
          <span className="absolute -top-2 left-1/2 h-4 w-4 -translate-x-1/2 rounded-full bg-signal shadow-[0_0_14px_var(--signal)]" />
        </div>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            each loop mints
          </span>
          <span className="font-display text-lg font-bold text-signal-ink">
            a costly edge
          </span>
        </div>
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
