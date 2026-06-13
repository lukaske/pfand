-- =============================================================================
-- Pfand index schema (Supabase / Postgres)
-- =============================================================================
-- Apply via the Supabase SQL editor or `psql "$SUPABASE_DB_URL" -f schema.sql`.
-- The shapes here mirror the canonical domain types in
-- packages/shared/src/db.ts (Agent, FeedbackEntry, Job, ActivityBucket).
-- Embedding dimension is 256 and MUST match indexer/src/embed.ts (EMBED_DIM).
-- =============================================================================

create extension if not exists vector;       -- pgvector, for hybrid semantic search
create extension if not exists pg_trgm;       -- trigram, for fuzzy free-text fallback

-- -----------------------------------------------------------------------------
-- agents: one row per ERC-8004 agent (mainnet) or Arc agent.
-- Primary key is (network, agent_id) because agentIds are only unique per chain.
-- -----------------------------------------------------------------------------
create table if not exists agents (
  network            text        not null check (network in ('mainnet','arc')),
  agent_id           text        not null,                 -- uint256 as decimal string
  owner              text        not null,                 -- 0x address (lowercased)
  agent_uri          text        not null,
  name               text        not null default '',
  description        text        not null default '',
  image              text,
  skills             text[]      not null default '{}',
  domains            text[]      not null default '{}',
  x402_support       boolean     not null default false,
  service_endpoint   text,
  pay_to_wallet      text,
  ens_name           text,
  payable            boolean     not null default false,
  price_usdc         numeric,
  -- denormalized reputation summary (see ReputationSummary in db.ts)
  reputation_count   integer     not null default 0,
  reputation_score   numeric,                              -- human float (avg), null if no feedback
  reputation_score_normalized numeric,                     -- 0..100, null if no feedback
  created_at_block   bigint,
  created_at         timestamptz,
  -- hybrid search vector over name+description+skills+domains
  embedding          vector(256),
  indexed_at         timestamptz not null default now(),
  primary key (network, agent_id)
);

create index if not exists agents_x402_idx       on agents (x402_support);
create index if not exists agents_payable_idx     on agents (payable);
create index if not exists agents_repscore_idx    on agents (reputation_score_normalized desc nulls last);
create index if not exists agents_skills_gin      on agents using gin (skills);
create index if not exists agents_name_trgm       on agents using gin (name gin_trgm_ops);
-- ANN index for vector distance. ivfflat needs ANALYZE after bulk load.
create index if not exists agents_embedding_ivf
  on agents using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- -----------------------------------------------------------------------------
-- feedback: one row per NewFeedback event (ERC-8004 ReputationRegistry).
-- score = value / 10^value_decimals (signed fixed-point).
-- -----------------------------------------------------------------------------
create table if not exists feedback (
  network          text     not null check (network in ('mainnet','arc')),
  agent_id         text     not null,
  client           text     not null,                      -- 0x address (lowercased)
  feedback_index   bigint   not null,                      -- uint64 per (agent,client)
  value            numeric  not null,                      -- raw signed fixed-point
  value_decimals   integer  not null,
  score            numeric  not null,                      -- value / 10^value_decimals
  tag1             text     not null default '',
  tag2             text     not null default '',
  feedback_uri     text     not null default '',
  is_revoked       boolean  not null default false,
  tx_hash          text,
  block_number     bigint,
  timestamp        timestamptz,
  primary key (network, agent_id, client, feedback_index)
);

create index if not exists feedback_agent_idx on feedback (network, agent_id);
create index if not exists feedback_ts_idx    on feedback (timestamp);

-- -----------------------------------------------------------------------------
-- jobs: Pfand RebateEscrow jobs on Arc (see Job in db.ts).
-- -----------------------------------------------------------------------------
create table if not exists jobs (
  job_id            text        primary key,                -- uint256 as decimal string
  client            text        not null,
  service_wallet    text        not null,
  agent_id          text        not null,
  fee               text        not null,                   -- USDC 6-dec base units, as string
  pfand             text        not null,                   -- USDC 6-dec base units, as string
  status            text        not null default 'open'
                     check (status in ('open','completed','settled','forfeited')),
  feedback_deadline bigint      not null default 0,          -- unix seconds
  rebate_claimable  boolean     not null default false,
  tx_open           text,
  tx_complete       text,
  tx_feedback       text,
  tx_claim          text,
  updated_at        timestamptz not null default now()
);

create index if not exists jobs_agent_idx  on jobs (agent_id);
create index if not exists jobs_status_idx on jobs (status);

-- -----------------------------------------------------------------------------
-- activity: daily heatmap buckets (ActivityBucket in db.ts).
-- One row per (network, day) with registration + feedback counts.
-- -----------------------------------------------------------------------------
create table if not exists activity (
  network        text not null check (network in ('mainnet','arc')),
  day            date not null,
  registrations  integer not null default 0,
  feedback       integer not null default 0,
  primary key (network, day)
);

-- =============================================================================
-- search_agents(): hybrid search RPC.
--   1. Apply HARD filters from `filters` jsonb (skills, price, score, x402,
--      payable, network) — these are exact, not fuzzy.
--   2. Order the surviving rows by cosine distance to `query_embedding`.
--      If query_embedding is NULL, fall back to reputation ordering.
-- Returns the agent columns + a semantic_score in [0,1] (1 - cosine distance).
--
-- filters jsonb shape (all keys optional; mirrors SearchFilters in db.ts):
--   {
--     "skills":        ["research","trading"],   -- agent must have ALL of these
--     "maxPriceUsdc":  5,
--     "minScore":      80,                         -- normalized 0..100
--     "requiresX402":  true,
--     "payableOnly":   true,
--     "network":       "mainnet"                   -- optional extra filter
--   }
-- =============================================================================
create or replace function search_agents(
  filters         jsonb,
  query_embedding vector(256) default null,
  match_count     int          default 20
)
returns table (
  network          text,
  agent_id         text,
  owner            text,
  agent_uri        text,
  name             text,
  description      text,
  image            text,
  skills           text[],
  domains          text[],
  x402_support     boolean,
  service_endpoint text,
  pay_to_wallet    text,
  ens_name         text,
  payable          boolean,
  price_usdc       numeric,
  reputation_count integer,
  reputation_score numeric,
  reputation_score_normalized numeric,
  created_at_block bigint,
  created_at       timestamptz,
  semantic_score   double precision
)
language sql
stable
as $$
  with f as (
    select
      coalesce(
        array(select jsonb_array_elements_text(filters->'skills')),
        '{}'
      )::text[]                                              as want_skills,
      nullif(filters->>'maxPriceUsdc','')::numeric           as max_price,
      nullif(filters->>'minScore','')::numeric              as min_score,
      (filters->>'requiresX402')::boolean                    as requires_x402,
      (filters->>'payableOnly')::boolean                     as payable_only,
      nullif(filters->>'network','')                         as want_network
  )
  select
    a.network, a.agent_id, a.owner, a.agent_uri, a.name, a.description, a.image,
    a.skills, a.domains, a.x402_support, a.service_endpoint, a.pay_to_wallet,
    a.ens_name, a.payable, a.price_usdc, a.reputation_count, a.reputation_score,
    a.reputation_score_normalized, a.created_at_block, a.created_at,
    case
      when query_embedding is null or a.embedding is null then null
      else 1 - (a.embedding <=> query_embedding)              -- cosine similarity 0..1
    end as semantic_score
  from agents a, f
  where
    -- skills: agent must contain ALL requested skills (empty => no constraint)
    (cardinality(f.want_skills) = 0 or a.skills @> f.want_skills)
    and (f.max_price is null or (a.price_usdc is not null and a.price_usdc <= f.max_price))
    and (f.min_score is null or (a.reputation_score_normalized is not null
                                 and a.reputation_score_normalized >= f.min_score))
    and (f.requires_x402 is not true or a.x402_support = true)
    and (f.payable_only  is not true or a.payable = true)
    and (f.want_network is null or a.network = f.want_network)
  order by
    -- hybrid: semantic distance first when we have an embedding, else reputation
    case when query_embedding is null or a.embedding is null then 1 else 0 end,
    a.embedding <=> query_embedding nulls last,
    a.reputation_score_normalized desc nulls last
  limit match_count;
$$;

-- Run `analyze agents;` after a bulk load so the ivfflat index is usable.
