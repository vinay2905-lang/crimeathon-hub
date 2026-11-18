-- Run this once in your Supabase SQL Editor to create all Crimeathon Hub tables and storage bucket.

create table if not exists public.cases (
  id text primary key,
  code text not null unique,
  title text not null,
  category text not null,
  difficulty text not null,
  briefing text not null,
  objectives jsonb not null default '[]'::jsonb,
  status text not null default 'published',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.evidence_files (
  id text primary key,
  case_id text not null references public.cases(id) on delete cascade,
  original_name text not null,
  stored_name text not null,
  extension text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  uploaded_at timestamptz not null default now(),
  download_count integer not null default 0
);

create table if not exists public.users (
  id text primary key,
  name text not null,
  email text not null unique,
  college_id text not null default 'SIMATS',
  team_id text,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.teams (
  id text primary key,
  team_code text not null unique,
  team_name text not null,
  invite_code text not null unique,
  leader_id text not null,
  leader_email text not null,
  members text not null default '',
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now()
);

create table if not exists public.team_members (
  team_id text not null references public.teams(id) on delete cascade,
  user_id text not null references public.users(id) on delete cascade,
  name text not null,
  email text not null,
  role text not null default 'Member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create table if not exists public.team_invites (
  id text primary key,
  team_id text not null references public.teams(id) on delete cascade,
  email text not null,
  invited_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.submissions (
  id text primary key,
  team_id text not null references public.teams(id) on delete cascade,
  team_code text not null,
  team_name text not null,
  case_id text not null references public.cases(id) on delete cascade,
  case_code text not null,
  case_title text not null,
  summary text not null,
  methodology text not null,
  file_name text not null,
  stored_name text not null,
  extension text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  submitted_at timestamptz not null default now(),
  status text not null default 'Submitted',
  score integer,
  judge_feedback text not null default '',
  evaluated_at timestamptz
);

create table if not exists public.activities (
  id text primary key,
  type text not null,
  team_code text not null,
  team_name text not null,
  case_code text,
  file_name text,
  details text not null,
  timestamp timestamptz not null default now()
);

create index if not exists idx_evidence_case_id on public.evidence_files(case_id);
create index if not exists idx_submissions_team_id on public.submissions(team_id);
create index if not exists idx_activities_timestamp on public.activities(timestamp desc);

-- Create private storage bucket for case evidence packs and submitted investigation reports
insert into storage.buckets (id, name, public)
values ('crimeathon-files', 'crimeathon-files', false)
on conflict (id) do nothing;
