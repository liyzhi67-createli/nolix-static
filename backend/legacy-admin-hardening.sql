-- Preserve legacy tables while binding every administrator check to the same
-- verified immutable owner identity. Trigger execution is unaffected by RPC ACLs.
create or replace function public.is_admin() returns boolean
language sql stable security invoker set search_path = ''
as $$ select private.is_nolix_admin(); $$;
revoke all on function public.is_admin() from public,anon,authenticated;
grant execute on function public.is_admin() to authenticated;
revoke execute on function public.handle_new_user() from public,anon,authenticated;
-- The retired prototype endpoint must not accept CAPTCHA-free submissions.
revoke insert on public.submissions from public,anon,authenticated;
