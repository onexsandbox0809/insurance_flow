-- =====================================================================================
--  Insurance flows : complete Supabase schema
--  Run this whole file once in  Supabase > SQL Editor.   Then run seed.sql (optional).
--  Time zone: Asia/Kolkata.  Dates: DD-MM-YYYY.  Times: HH-mm (24 hour).
-- =====================================================================================

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm  with schema extensions;

alter database postgres set timezone to 'Asia/Kolkata';
set timezone to 'Asia/Kolkata';

-- ---------- helpers: Indian date / time as text ----------
create or replace function ist_date(ts timestamptz default now())
returns text language sql stable as $$ select to_char(ts at time zone 'Asia/Kolkata', 'DD-MM-YYYY') $$;

create or replace function ist_time(ts timestamptz default now())
returns text language sql stable as $$ select to_char(ts at time zone 'Asia/Kolkata', 'HH24-MI') $$;

-- ---------- unique proposal number: HP-YYMMDD-00001 ----------
create sequence if not exists proposal_seq start 1;

create or replace function next_proposal_no()
returns text language plpgsql as $$
begin
  return 'HP-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' || lpad(nextval('proposal_seq')::text, 5, '0');
end $$;

-- =====================================================================================
--  1. proposals : the centralised table (one row per customer proposal, filled flow by flow)
-- =====================================================================================
create table if not exists proposals (
  id                      bigint generated always as identity primary key,
  proposal_no             text not null unique default next_proposal_no(),
  wa_id                   text not null,                              -- customer WhatsApp number
  status                  text not null default 'draft' check (status in ('draft', 'quoted', 'completed')),
  flows_completed         text[] not null default '{}',

  -- entry stamp (Indian time)
  entry_date              text not null default ist_date(),           -- DD-MM-YYYY
  entry_time              text not null default ist_time(),           -- HH-mm
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  updated_date            text default ist_date(),
  updated_time            text default ist_time(),

  -- when each flow was submitted ('DD-MM-YYYY HH-mm')
  flow_personal_at        text,
  flow_nominee_at         text,
  flow_insured_at         text,
  flow_medical_at         text,
  flow_covers_at          text,
  flow_documents_at       text,

  -- Flow 1 : personal information
  full_name               text,
  dob                     text,                                       -- DD-MM-YYYY
  gender                  text,
  marital_status          text,
  occupation              text,
  pan                     text,                                       -- masked: first 2 + last 1 visible
  aadhaar                 text,                                       -- masked: only last 4 visible
  e_insurance_no          text,
  pin                     text,
  city                    text,
  state                   text,
  village                 text,
  address                 text,
  servicing_office        text,
  tel_std                 text,
  tel_home                text,
  mobile                  text,
  email                   text,
  ckyc_no                 text,
  contact_consent         boolean,

  -- Flow 2 : nominee
  nominee_name            text,
  nominee_relation        text,
  nominee_address         text,
  nominee_contact         text,

  -- Flow 3 : insured persons
  persons                 smallint check (persons in (1, 2)),
  p1_gender               text,
  p1_relation             text,
  p1_name                 text,
  p1_dob                  text,
  p1_aadhaar              text,                                       -- masked
  p1_sum_insured          text,
  p1_height               numeric(5,2),
  p1_weight               numeric(6,2),
  p1_blood_group          text,
  p1_marital_status       text,
  p1_dependent            text,
  p1_employment           text,
  p1_occupation           text,
  p2_gender               text,
  p2_relation             text,
  p2_name                 text,
  p2_dob                  text,
  p2_aadhaar              text,                                       -- masked
  p2_sum_insured          text,
  p2_height               numeric(5,2),
  p2_weight               numeric(6,2),
  p2_blood_group          text,
  p2_marital_status       text,
  p2_dependent            text,
  p2_employment           text,
  p2_occupation           text,

  -- Flow 5 : medical and habits
  any_condition           text,
  p1_diabetes             text,
  p1_hypertension         text,
  p1_haemolytic_anaemia   text,
  p1_epilepsy             text,
  p1_renal_stones         text,
  p1_asthma               text,
  p1_tobacco              text,
  p1_alcohol              text,
  p1_cigarettes           text,
  habit_quantity          text,

  -- Flow 6 : optional covers
  covers                  text[],
  p1_restoration          text,
  p1_maternity            text,
  p1_daily_cash           text,
  p1_daily_cash_amt       text,

  -- Flow 7 : document links (short URLs, several files are comma separated)
  id_proof_url            text,
  address_proof_url       text,
  age_proof_url           text,
  previous_policy_url     text,
  medical_report_url      text,
  pan_doc_url             text,

  -- Quote / premium
  quote_status            text not null default 'not_ready' check (quote_status in ('not_ready', 'quoted')),
  total_sum_insured       numeric(14,2),
  premium_option          text not null default 'Annual',             -- selected payment option
  premium_base            numeric(12,2),
  premium_loading         numeric(12,2),
  premium_discount        numeric(12,2),
  premium_addons          numeric(12,2),
  premium_net             numeric(12,2),
  premium_gst             numeric(12,2),
  premium_annual          numeric(12,2),                              -- total payable per year incl. GST
  premium_half_yearly     numeric(12,2),                              -- instalment amounts
  premium_quarterly       numeric(12,2),
  premium_monthly         numeric(12,2),
  quote_valid_till        text,                                       -- DD-MM-YYYY
  premium_breakdown       jsonb,

  -- Proposal PDF
  proposal_pdf_url        text,                                       -- short URL  {APP_BASE_URL}/p/<code>
  proposal_pdf_generated_at text                                      -- DD-MM-YYYY HH-mm
);

create index if not exists idx_proposals_wa_id      on proposals (wa_id);
create index if not exists idx_proposals_status     on proposals (status);
create index if not exists idx_proposals_created    on proposals (created_at desc);
create index if not exists idx_proposals_name_trgm  on proposals using gin (full_name extensions.gin_trgm_ops);
create index if not exists idx_proposals_mobile_trgm on proposals using gin (mobile extensions.gin_trgm_ops);

create or replace function touch_proposal() returns trigger language plpgsql as $$
begin
  new.updated_at   := now();
  new.updated_date := ist_date(new.updated_at);
  new.updated_time := ist_time(new.updated_at);
  return new;
end $$;

drop trigger if exists trg_touch_proposal on proposals;
create trigger trg_touch_proposal before update on proposals
  for each row execute function touch_proposal();

-- =====================================================================================
--  2. proposal_documents : one row per uploaded WhatsApp file
-- =====================================================================================
create table if not exists proposal_documents (
  id                  bigint generated always as identity primary key,
  proposal_no         text not null references proposals (proposal_no) on delete cascade,
  doc_type            text not null check (doc_type in ('id_proof','address_proof','age_proof','previous_policy_docs','prepolicy_reports','pan_doc')),
  doc_label           text,
  file_index          smallint not null default 1,
  whatsapp_media_id   text not null,                                  -- id received from WhatsApp
  sha256              text,                                           -- sha256 received from WhatsApp (base64)
  sha256_computed     text,                                           -- sha256 of the stored file (base64)
  sha256_match        boolean,
  mime_type           text,
  file_name           text,
  size_bytes          bigint,
  source_media_url    text,                                           -- temporary URL returned by API 1
  storage_bucket      text not null default 'proposal-docs',
  storage_path        text,
  short_code          text unique,
  short_url           text,                                           -- {APP_BASE_URL}/d/<code>
  status              text not null default 'stored' check (status in ('pending','stored','failed','sample')),
  error               text,
  created_at          timestamptz not null default now(),
  created_date        text not null default ist_date(),
  created_time        text not null default ist_time(),
  unique (proposal_no, whatsapp_media_id)
);
create index if not exists idx_docs_proposal on proposal_documents (proposal_no);

-- =====================================================================================
--  3. short_links : short code -> private storage object
-- =====================================================================================
create table if not exists short_links (
  code            text primary key,
  kind            text not null check (kind in ('doc', 'pdf')),
  proposal_no     text references proposals (proposal_no) on delete cascade,
  storage_bucket  text not null,
  storage_path    text not null,
  mime_type       text,
  file_name       text,
  hits            integer not null default 0,
  created_at      timestamptz not null default now(),
  created_date    text not null default ist_date(),
  created_time    text not null default ist_time()
);

-- =====================================================================================
--  4. flow_submissions : audit trail, one row per flow submission (payload is already masked)
-- =====================================================================================
create table if not exists flow_submissions (
  id            bigint generated always as identity primary key,
  proposal_no   text not null references proposals (proposal_no) on delete cascade,
  flow_key      text not null,
  payload       jsonb,
  created_at    timestamptz not null default now(),
  created_date  text not null default ist_date(),
  created_time  text not null default ist_time()
);
create index if not exists idx_submissions_proposal on flow_submissions (proposal_no);

-- =====================================================================================
--  5. app_users : dashboard login (login id + password, password stored as a bcrypt hash)
-- =====================================================================================
create table if not exists app_users (
  id             bigint generated always as identity primary key,
  login_id       text not null unique,
  password_hash  text not null,
  display_name   text,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  created_date   text not null default ist_date(),
  created_time   text not null default ist_time()
);

create or replace function verify_app_user(p_login text, p_password text)
returns table (out_login_id text, out_display_name text)
language sql security definer set search_path = public, extensions as $$
  select u.login_id, coalesce(u.display_name, u.login_id)
  from app_users u
  where u.login_id = p_login and u.is_active and u.password_hash = extensions.crypt(p_password, u.password_hash)
$$;

-- add a user:  insert into app_users (login_id, password_hash, display_name)
--              values ('ops', extensions.crypt('a-strong-password', extensions.gen_salt('bf')), 'Operations');

-- ---------- short link lookup that also counts the visit ----------
create or replace function hit_short_link(p_code text)
returns setof short_links language sql as $$
  update short_links set hits = hits + 1 where code = p_code returning *;
$$;

-- ---------- numbers for the dashboard header ----------
create or replace function dashboard_stats()
returns json language sql stable as $$
  select json_build_object(
    'total',         count(*),
    'draft',         count(*) filter (where status = 'draft'),
    'quoted',        count(*) filter (where status = 'quoted'),
    'completed',     count(*) filter (where status = 'completed'),
    'today',         count(*) filter (where entry_date = ist_date()),
    'premium_total', coalesce(sum(premium_annual), 0),
    'premium_avg',   coalesce(round(avg(premium_annual), 2), 0),
    'documents',     (select count(*) from proposal_documents where status = 'stored')
  ) from proposals
$$;

-- =====================================================================================
--  Security: only the server (service role key) may touch these tables.
-- =====================================================================================
alter table proposals          enable row level security;
alter table proposal_documents enable row level security;
alter table short_links        enable row level security;
alter table flow_submissions   enable row level security;
alter table app_users          enable row level security;

revoke all on proposals, proposal_documents, short_links, flow_submissions, app_users from anon, authenticated;
revoke execute on function verify_app_user(text, text), hit_short_link(text), dashboard_stats(), next_proposal_no() from public, anon, authenticated;
grant  execute on function verify_app_user(text, text), hit_short_link(text), dashboard_stats(), next_proposal_no() to service_role;

-- =====================================================================================
--  Private storage bucket for documents and proposal PDFs
-- =====================================================================================
insert into storage.buckets (id, name, public)
values ('proposal-docs', 'proposal-docs', false)
on conflict (id) do nothing;
