-- All fixtures and simulated receipts are rolled back. No real payment is confirmed.
begin;
do $$
declare
 admin_uid uuid;
 admin_email text;
 foreign_uid uuid:=gen_random_uuid();
 site1 uuid:=gen_random_uuid();
 site2 uuid:=gen_random_uuid();
 pending_site uuid:=gen_random_uuid();
 o1 jsonb;
 o2 jsonb;
 probe jsonb;
 count_rows integer;
begin
 select user_id into admin_uid from private.admin_identities where user_id is not null limit 1;
 if admin_uid is null then raise exception 'No bound admin'; end if;
 select email into admin_email from auth.users where id=admin_uid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'email',(select email from auth.users where id=admin_uid),'role','authenticated')::text,true);
 insert into public.nolix_submissions(id,owner_user_id,owner_email,name,url,category,summary,relationship,status)
 values(site1,admin_uid,'test@example.invalid','Promotion test A','https://promotion-a.example.invalid','开发与工具','Temporary rollback test website A','开发者','pending'),
 (site2,admin_uid,'test@example.invalid','Promotion test B','https://promotion-b.example.invalid','开发与工具','Temporary rollback test website B','开发者','pending'),
 (pending_site,admin_uid,'test@example.invalid','Promotion pending','https://promotion-pending.example.invalid','开发与工具','Temporary rollback pending website','开发者','pending');
 execute 'set local role authenticated';
 update public.nolix_submissions set status='approved',reviewed_at=now() where id in(site1,site2);
 o1:=public.noliz_promotion_action('create',site1,null,'wechat');
 probe:=public.noliz_promotion_action('create',site1,null,'wechat');
 if probe->>'id'<>o1->>'id' or (o1->>'amount_fen')::integer<>9900 then raise exception 'Duplicate/price test failed'; end if;
 begin
  perform public.noliz_promotion_action('create',pending_site,null,'wechat');
  raise exception 'Pending site incorrectly accepted';
 exception when others then if sqlerrm<>'not_eligible' then raise; end if; end;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',foreign_uid,'email',admin_email,'role','authenticated','user_metadata',jsonb_build_object('role','admin'))::text,true);
 if public.noliz_is_admin() then raise exception 'Forged admin claim accepted'; end if;
 select count(*) into count_rows from public.noliz_promotion_orders where id=(o1->>'id')::uuid;
 if count_rows<>0 then raise exception 'Private order leaked'; end if;
 begin
  perform public.noliz_promotion_action('create',site1,null,'wechat');
  raise exception 'Foreign owner accepted';
 exception when others then if sqlerrm<>'forbidden' then raise; end if; end;
 begin
  perform public.noliz_promotion_action('verify',null,(o1->>'id')::uuid,null,'TEST-REF-000001',null,9900,true);
  raise exception 'Member verified payment';
 exception when others then if sqlerrm<>'forbidden' then raise; end if; end;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'email',(select email from auth.users where id=admin_uid),'role','authenticated')::text,true);
 execute 'set local role authenticated';
 perform public.noliz_promotion_action('report',null,(o1->>'id')::uuid,null,'TEST-REF-000001','rollback only');
 begin
  perform public.noliz_promotion_action('verify',null,(o1->>'id')::uuid,null,'TEST-REF-000001',null,9800,true);
  raise exception 'Wrong amount accepted';
 exception when others then if sqlerrm<>'amount_mismatch' then raise; end if; end;
 begin
  perform public.noliz_promotion_action('verify',null,(o1->>'id')::uuid,null,'TEST-REF-000001',null,9900,false);
  raise exception 'Missing ledger check accepted';
 exception when others then if sqlerrm<>'amount_mismatch' then raise; end if; end;
 begin
  perform public.noliz_promotion_action('verify',null,(o1->>'id')::uuid,null,'TEST-REF-000002',null,9900,true);
  raise exception 'Wrong reference accepted';
 exception when others then if sqlerrm<>'reference_mismatch' then raise; end if; end;
 probe:=public.noliz_promotion_action('verify',null,(o1->>'id')::uuid,null,'TEST-REF-000001','rollback only',9900,true);
 if probe->>'status'<>'verified' then raise exception 'Receipt verification failed'; end if;
 perform public.noliz_promotion_action('verify',null,(o1->>'id')::uuid,null,'TEST-REF-000001','rollback only',9900,true);
 o2:=public.noliz_promotion_action('create',site2,null,'wechat');
 perform public.noliz_promotion_action('report',null,(o2->>'id')::uuid,null,'TEST-REF-000001');
 begin
  perform public.noliz_promotion_action('verify',null,(o2->>'id')::uuid,null,'TEST-REF-000001',null,9900,true);
  raise exception 'Reused transaction accepted';
 exception when others then if sqlerrm<>'transaction_used' then raise; end if; end;
 execute 'set local role anon';
 perform set_config('request.jwt.claims','{"role":"anon"}',true);
 probe:=public.noliz_home_content();
 if not exists(select 1 from jsonb_array_elements(probe->'promotions') x where x->>'id'=site1::text) then raise exception 'Verified site absent'; end if;
 if probe::text like '%TEST-REF-%' or probe::text like '%test@example.invalid%' then raise exception 'Public payment details leaked'; end if;
 begin
  perform count(*) from public.noliz_promotion_orders;
  raise exception 'Anonymous private orders readable';
 exception when insufficient_privilege then null; end;
 begin
  perform public.noliz_promotion_action('create',site1,null,'wechat');
  raise exception 'Anonymous action allowed';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
 perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_uid,'email',(select email from auth.users where id=admin_uid),'role','authenticated')::text,true);
 execute 'set local role authenticated';
 update public.nolix_submissions set status='rejected',reviewed_at=now() where id=site1;
 probe:=public.noliz_home_content();
 if exists(select 1 from jsonb_array_elements(probe->'promotions') x where x->>'id'=site1::text) then raise exception 'Unlisted paid site still visible'; end if;
 update public.nolix_submissions set status='approved',reviewed_at=now() where id=site1;
 perform public.noliz_promotion_action('revoke',null,(o1->>'id')::uuid,null,null,'rollback revoke test');
 probe:=public.noliz_home_content();
 if exists(select 1 from jsonb_array_elements(probe->'promotions') x where x->>'id'=site1::text) then raise exception 'Revoked site still visible'; end if;
 begin
  insert into public.noliz_promotions(submission_id) values(pending_site);
  raise exception 'Direct promotion write allowed';
 exception when insufficient_privilege then null; end;
end;
$$;
rollback;
select 'PASS: duplicate-order safety, fixed 9900 fen, pending-site rejection, forged-admin rejection, owner RLS, member verification denial, amount/ledger/reference checks, transaction reuse rejection, idempotency, anonymous privacy, unlisting, revocation, direct-write denial; all fixtures rolled back.' as test_result;
