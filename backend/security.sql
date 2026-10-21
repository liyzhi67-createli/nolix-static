-- Additive Noliz upgrade. Existing nolix_* names deliberately retain live data.
create table public.noliz_captcha_challenges (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  answer_hash text not null check (length(answer_hash) = 64),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '5 minutes',
  consumed_at timestamptz
);
create index noliz_captcha_user_created_idx on public.noliz_captcha_challenges(user_id,created_at desc);
alter table public.noliz_captcha_challenges enable row level security;
revoke all on public.noliz_captcha_challenges from public, anon, authenticated;
grant select,insert,update,delete on public.noliz_captcha_challenges to service_role;

create function public.noliz_is_admin() returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.is_nolix_admin(); $$;
revoke all on function public.noliz_is_admin() from public,anon,authenticated;
grant execute on function public.noliz_is_admin() to authenticated;

-- These are backend-only RPCs. Neither browser role can issue challenges,
-- read answer hashes, consume a challenge, or directly create a submission.
create function public.noliz_issue_captcha(p_id uuid,p_user_id uuid,p_answer_hash text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  if (select count(*) from public.noliz_captcha_challenges where user_id=p_user_id and created_at>now()-interval '10 minutes') >= 10 then
    return jsonb_build_object('error_code','rate_limited');
  end if;
  insert into public.noliz_captcha_challenges(id,user_id,answer_hash) values(p_id,p_user_id,p_answer_hash);
  return jsonb_build_object('id',p_id,'expires_in',300);
end; $$;
revoke all on function public.noliz_issue_captcha(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.noliz_issue_captcha(uuid,uuid,text) to service_role;

create function public.noliz_complete_submission(p_challenge_id uuid,p_user_id uuid,p_email text,p_answer_hash text,p_data jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare challenge public.noliz_captcha_challenges%rowtype; submission_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_user_id::text,0));
  select * into challenge from public.noliz_captcha_challenges where id=p_challenge_id and user_id=p_user_id for update;
  if not found or challenge.consumed_at is not null then return jsonb_build_object('error_code','captcha_invalid'); end if;
  update public.noliz_captcha_challenges set consumed_at=now() where id=p_challenge_id;
  if challenge.expires_at < now() then return jsonb_build_object('error_code','captcha_expired'); end if;
  if challenge.answer_hash <> p_answer_hash then return jsonb_build_object('error_code','captcha_invalid'); end if;
  if (select count(*) from public.nolix_submissions where owner_user_id=p_user_id and created_at>now()-interval '10 minutes') >= 3 then
    return jsonb_build_object('error_code','rate_limited');
  end if;
  begin
    insert into public.nolix_submissions(owner_user_id,owner_email,name,url,category,summary,relationship)
    values(p_user_id,lower(p_email),p_data->>'name',p_data->>'url',p_data->>'category',p_data->>'summary',p_data->>'relationship')
    returning id into submission_id;
  exception when unique_violation then return jsonb_build_object('error_code','duplicate');
    when check_violation then return jsonb_build_object('error_code','validation_failed');
  end;
  return jsonb_build_object('id',submission_id,'status','pending');
end; $$;
revoke all on function public.noliz_complete_submission(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.noliz_complete_submission(uuid,uuid,text,text,jsonb) to service_role;
grant insert,select on public.nolix_submissions to service_role;

-- Close the old direct-POST bypass, including the column-level grants.
revoke insert (name,url,category,summary,relationship) on public.nolix_submissions from authenticated;
revoke insert on public.nolix_submissions from authenticated,anon;
drop policy nolix_submissions_insert_own on public.nolix_submissions;
-- The existing admin-only RLS policy and sync trigger govern these edits.
grant update(name,url,category,summary,relationship) on public.nolix_submissions to authenticated;
