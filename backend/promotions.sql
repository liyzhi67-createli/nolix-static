-- Additive promotion workflow. Existing listing subscriptions remain unchanged.
-- CNY 99/site, no scheduled expiry. No browser is allowed to mark an order paid.
create table public.noliz_promotion_orders (
 id uuid primary key default gen_random_uuid(),
 submission_id uuid not null references public.nolix_submissions(id),
 owner_user_id uuid not null references auth.users(id),
 channel text not null check (channel in ('wechat','alipay')),
 amount_fen integer not null default 9900 check (amount_fen=9900),
 status text not null default 'pending' check (status in ('pending','reported','verified','closed')),
 claim_reference text check (length(claim_reference) between 6 and 100),
 payer_note text check (length(payer_note)<=100),
 reported_at timestamptz,
 received_fen integer check (received_fen=9900),
 verified_reference text check (length(verified_reference) between 6 and 100),
 verified_by uuid references auth.users(id),
 verified_at timestamptz,
 revoked_at timestamptz,
 review_note text check (length(review_note)<=500),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days',
 check (status<>'verified' or (received_fen is not null and received_fen=9900 and verified_reference is not null and verified_by is not null and verified_at is not null))
);
create unique index noliz_promotion_one_open on public.noliz_promotion_orders(submission_id) where status in ('pending','reported','verified');
create unique index noliz_promotion_transaction_once on public.noliz_promotion_orders(channel,verified_reference) where verified_reference is not null;
create index noliz_promotion_owner_created on public.noliz_promotion_orders(owner_user_id,created_at desc);
create index noliz_promotion_review_queue on public.noliz_promotion_orders(status,created_at desc);
create index noliz_promotion_verifier on public.noliz_promotion_orders(verified_by);
alter table public.noliz_promotion_orders enable row level security;
revoke all on public.noliz_promotion_orders from public,anon,authenticated;
grant select on public.noliz_promotion_orders to authenticated;
create policy promotion_read on public.noliz_promotion_orders for select to authenticated
 using (owner_user_id=(select auth.uid()) or (select private.is_nolix_admin()));

-- Public projection contains no payer information, transaction IDs, or order IDs.
create table public.noliz_promotions (
 submission_id uuid primary key references public.nolix_submissions(id),
 confirmed_at timestamptz not null default now(),
 active boolean not null default true
);
alter table public.noliz_promotions enable row level security;
revoke all on public.noliz_promotions from public,anon,authenticated;
grant select on public.noliz_promotions to anon,authenticated;
create policy promotion_public on public.noliz_promotions for select to anon,authenticated
 using (active and exists (select 1 from public.nolix_public_listings l where l.id=submission_id));

create function private.noliz_promotion_action(p_action text,p_submission uuid default null,p_order uuid default null,p_channel text default null,p_reference text default null,p_note text default null,p_received_fen integer default null,p_ledger_checked boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid := (select auth.uid());
 s public.nolix_submissions;
 o public.noliz_promotion_orders;
 sid uuid;
 ref text := btrim(coalesce(p_reference,''));
 note text := btrim(coalesce(p_note,''));
begin
 if uid is null then raise exception 'unauthorized'; end if;
 if p_action not in ('create','report','verify','close','revoke') then raise exception 'invalid'; end if;
 if p_action in ('verify','close','revoke') and not private.is_nolix_admin() then raise exception 'forbidden'; end if;
 if length(note)>500 then raise exception 'invalid'; end if;
 -- Lock the submission first, then the order, in the same order in every path.
 if p_action='create' then sid:=p_submission;
 else select submission_id into sid from public.noliz_promotion_orders where id=p_order;
 end if;
 select * into s from public.nolix_submissions where id=sid for update;
 if s.id is null then raise exception 'not_eligible'; end if;
 if p_action in ('create','report') and s.owner_user_id is distinct from uid then raise exception 'forbidden'; end if;
 if p_action in ('create','report','verify') and (s.status<>'approved' or not exists(select 1 from public.nolix_public_listings where id=s.id)) then raise exception 'not_eligible'; end if;
 if p_action='create' then
  if p_channel is null or p_channel not in ('wechat','alipay') then raise exception 'invalid'; end if;
  update public.noliz_promotion_orders set status='closed' where submission_id=s.id and status='pending' and expires_at<now();
  select * into o from public.noliz_promotion_orders where submission_id=s.id and status in ('pending','reported','verified') for update;
  if o.id is null then
   if (select count(*) from public.noliz_promotion_orders where owner_user_id=uid and created_at>now()-interval '1 day')>=10 then raise exception 'rate_limited'; end if;
   insert into public.noliz_promotion_orders(submission_id,owner_user_id,channel) values(s.id,uid,p_channel) returning * into o;
  elsif o.status='pending' and o.channel<>p_channel then
   update public.noliz_promotion_orders set channel=p_channel where id=o.id returning * into o;
  end if;
  return to_jsonb(o);
 end if;
 select * into o from public.noliz_promotion_orders where id=p_order for update;
 if o.id is null then raise exception 'invalid'; end if;
 if p_action='report' then
  if o.owner_user_id<>uid then raise exception 'forbidden'; end if;
  if o.status='verified' then return to_jsonb(o); end if;
  if o.status not in ('pending','reported') then raise exception 'order_closed'; end if;
  if o.status='pending' and o.expires_at<now() then raise exception 'order_expired'; end if;
  if length(ref) not between 6 and 100 or length(note)>100 then raise exception 'invalid'; end if;
  update public.noliz_promotion_orders set status='reported',claim_reference=ref,payer_note=nullif(note,''),reported_at=now() where id=o.id returning * into o;
 elsif p_action='verify' then
  if p_ledger_checked is distinct from true or p_received_fen is distinct from 9900 or length(ref) not between 6 and 100 then raise exception 'amount_mismatch'; end if;
  if o.status='verified' then
   if o.verified_reference=ref and o.received_fen=p_received_fen then return to_jsonb(o); end if;
   raise exception 'order_closed';
  end if;
  if o.status<>'reported' then raise exception 'payment_not_reported'; end if;
  if o.claim_reference is distinct from ref then raise exception 'reference_mismatch'; end if;
  update public.noliz_promotion_orders set status='verified',received_fen=9900,verified_reference=ref,verified_by=uid,verified_at=now(),review_note=nullif(note,'') where id=o.id returning * into o;
  insert into public.noliz_promotions(submission_id) values(s.id) on conflict(submission_id) do update set active=true,confirmed_at=now();
 elsif p_action='close' then
  if o.status='verified' then raise exception 'order_closed'; end if;
  if note='' then raise exception 'note_required'; end if;
  update public.noliz_promotion_orders set status='closed',review_note=note where id=o.id returning * into o;
 elsif p_action='revoke' then
  if o.status<>'verified' or note='' then raise exception 'note_required'; end if;
  update public.noliz_promotions set active=false where submission_id=s.id;
  update public.noliz_promotion_orders set review_note=note,revoked_at=now() where id=o.id returning * into o;
 end if;
 return to_jsonb(o);
exception when unique_violation then raise exception 'transaction_used';
end;
$$;
revoke all on function private.noliz_promotion_action(text,uuid,uuid,text,text,text,integer,boolean) from public,anon,authenticated;
grant execute on function private.noliz_promotion_action(text,uuid,uuid,text,text,text,integer,boolean) to authenticated;
create function public.noliz_promotion_action(p_action text,p_submission uuid default null,p_order uuid default null,p_channel text default null,p_reference text default null,p_note text default null,p_received_fen integer default null,p_ledger_checked boolean default false)
returns jsonb language sql security invoker set search_path='' as $$
 select private.noliz_promotion_action(p_action,p_submission,p_order,p_channel,p_reference,p_note,p_received_fen,p_ledger_checked);
$$;
revoke all on function public.noliz_promotion_action(text,uuid,uuid,text,text,text,integer,boolean) from public,anon;
grant execute on function public.noliz_promotion_action(text,uuid,uuid,text,text,text,integer,boolean) to authenticated;

-- One public request for the home page; paid placement is NEVER loaded from local storage.
create function public.noliz_home_content() returns jsonb language sql security invoker set search_path='' as $$
 select jsonb_build_object(
 'listings',coalesce((select jsonb_agg(l) from (select id,name,url,category,summary,reviewed_at,display_until from public.nolix_public_listings order by reviewed_at desc nulls last,id limit 3)l),'[]'::jsonb),
 'promotions',coalesce((select jsonb_agg(p) from (select l.id,l.name,l.url,l.category,l.summary,l.reviewed_at,l.display_until from public.noliz_promotions p join public.nolix_public_listings l on l.id=p.submission_id where p.active order by random() limit 3)p),'[]'::jsonb));
$$;
revoke all on function public.noliz_home_content() from public;
grant execute on function public.noliz_home_content() to anon,authenticated;

-- Search/filter on the server and return only one page, rather than every site.
create function public.noliz_directory(p_query text default '',p_category text default '',p_sort text default 'latest',p_offset integer default 0)
returns jsonb language sql stable security invoker set search_path='' as $$
 with matched as (
  select id,name,url,category,summary,reviewed_at,display_until from public.nolix_public_listings
  where (coalesce(p_category,'')='' or category=p_category)
   and (coalesce(btrim(p_query),'')='' or strpos(lower(name||' '||url||' '||summary),lower(left(btrim(p_query),120)))>0)
 ), paged as (
  select * from matched order by case when p_sort='az' then lower(name) end asc, reviewed_at desc nulls last,id
  limit 24 offset greatest(0,least(coalesce(p_offset,0),24000))
 ) select jsonb_build_object('items',coalesce((select jsonb_agg(paged) from paged),'[]'::jsonb),'total',(select count(*) from matched));
$$;
revoke all on function public.noliz_directory(text,text,text,integer) from public;
grant execute on function public.noliz_directory(text,text,text,integer) to anon,authenticated;
notify pgrst,'reload schema';
