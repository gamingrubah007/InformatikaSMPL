-- =====================================================================
-- SQL untuk Supabase. Jalankan SEKALI di: Supabase > SQL Editor > New query
-- =====================================================================

create extension if not exists pgcrypto;

create table if not exists public.quizzes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  title text not null,
  description text default '',
  time_limit_min int not null default 0,        -- 0 = tanpa batas waktu
  shuffle_questions boolean not null default false,
  shuffle_options boolean not null default false,
  show_result boolean not null default true,    -- tampilkan kunci/pembahasan ke siswa
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  position int not null default 0,
  type text not null default 'mc' check (type in ('mc','short')),
  text text not null,
  options jsonb not null default '[]'::jsonb,   -- daftar teks pilihan (untuk 'mc')
  answer text not null default '',              -- mc: indeks "0","1",.. ; short: jawaban dipisah |
  explanation text default '',
  points numeric not null default 1
);
create index if not exists questions_quiz_idx on public.questions(quiz_id, position);

create table if not exists public.attempts (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  student_name text not null,
  score numeric not null,
  correct int not null,
  total int not null,
  answers jsonb not null default '{}'::jsonb,
  duration_sec int default 0,
  created_at timestamptz not null default now()
);
create index if not exists attempts_quiz_idx on public.attempts(quiz_id, created_at desc);

-- ---------------- Keamanan (RLS) ----------------
-- Siswa (anon) TIDAK bisa membaca tabel langsung, sehingga kunci jawaban aman.
-- Hanya admin yang login (authenticated) yang bisa membaca/menulis tabel.
alter table public.quizzes   enable row level security;
alter table public.questions enable row level security;
alter table public.attempts  enable row level security;

drop policy if exists admin_all_quizzes   on public.quizzes;
drop policy if exists admin_all_questions on public.questions;
drop policy if exists admin_all_attempts  on public.attempts;

create policy admin_all_quizzes   on public.quizzes   for all to authenticated using (true) with check (true);
create policy admin_all_questions on public.questions for all to authenticated using (true) with check (true);
create policy admin_all_attempts  on public.attempts  for all to authenticated using (true) with check (true);

-- ---------------- Fungsi untuk siswa ----------------
-- Mengambil kuis TANPA kunci jawaban.
create or replace function public.get_quiz(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.quizzes%rowtype;
begin
  select * into q from public.quizzes
   where upper(code) = upper(trim(p_code)) and is_active;
  if not found then
    return null;
  end if;

  return jsonb_build_object(
    'id', q.id,
    'code', q.code,
    'title', q.title,
    'description', q.description,
    'time_limit_min', q.time_limit_min,
    'shuffle_questions', q.shuffle_questions,
    'shuffle_options', q.shuffle_options,
    'show_result', q.show_result,
    'questions', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'id', x.id, 'type', x.type, 'text', x.text,
                 'options', x.options, 'points', x.points)
               order by x.position)
        from public.questions x where x.quiz_id = q.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Menilai jawaban di server dan menyimpan hasilnya.
create or replace function public.submit_attempt(
  p_code text, p_name text, p_answers jsonb, p_duration int
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.quizzes%rowtype;
  r record;
  ans text;
  ok boolean;
  got numeric := 0;
  total_pts numeric := 0;
  n_correct int := 0;
  n_total int := 0;
  pct numeric;
  review jsonb := '[]'::jsonb;
  shown text;
begin
  if p_name is null or length(trim(p_name)) = 0 then
    raise exception 'Nama wajib diisi';
  end if;

  select * into q from public.quizzes
   where upper(code) = upper(trim(p_code)) and is_active;
  if not found then
    raise exception 'Kuis tidak ditemukan atau sudah ditutup';
  end if;

  for r in select * from public.questions where quiz_id = q.id order by position loop
    n_total := n_total + 1;
    total_pts := total_pts + r.points;
    ans := p_answers ->> (r.id::text);

    if r.type = 'mc' then
      ok := ans is not null and ans = r.answer;
      if r.answer ~ '^[0-9]+$' then
        shown := chr(65 + r.answer::int) || '. ' || coalesce(r.options ->> (r.answer::int), '');
      else
        shown := '';
      end if;
    else
      ok := ans is not null and length(trim(ans)) > 0 and exists (
        select 1 from unnest(string_to_array(lower(r.answer), '|')) a
         where trim(a) = lower(trim(ans)));
      shown := replace(r.answer, '|', ' / ');
    end if;

    if ok then
      got := got + r.points;
      n_correct := n_correct + 1;
    end if;

    review := review || jsonb_build_object(
      'id', r.id, 'correct', ok, 'answer', shown, 'explanation', coalesce(r.explanation, ''));
  end loop;

  pct := case when total_pts > 0 then round(got / total_pts * 100, 1) else 0 end;

  insert into public.attempts (quiz_id, student_name, score, correct, total, answers, duration_sec)
  values (q.id, left(trim(p_name), 80), pct, n_correct, n_total,
          coalesce(p_answers, '{}'::jsonb), greatest(coalesce(p_duration, 0), 0));

  return jsonb_build_object(
    'score', pct,
    'correct', n_correct,
    'total', n_total,
    'show_result', q.show_result,
    'review', case when q.show_result then review else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.get_quiz(text) from public;
revoke all on function public.submit_attempt(text, text, jsonb, int) from public;
grant execute on function public.get_quiz(text) to anon, authenticated;
grant execute on function public.submit_attempt(text, text, jsonb, int) to anon, authenticated;
