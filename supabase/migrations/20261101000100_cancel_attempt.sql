-- ============================================================================
-- Cancel an exam in progress.
--
-- "Cancel" in the exam workspace discards the attempt entirely: its questions,
-- answers and flags are deleted, it never appears in history or analytics, and
-- the one-active-attempt-per-course slot is freed so a new exam can start.
-- Only the owner can cancel, and only while the attempt is still in progress —
-- a submitted or expired attempt is a permanent record.
-- (Save & Exit needs no server change: answers already save as they are
-- chosen, and the attempt can be resumed while its timer runs.)
-- ============================================================================

create or replace function public.cancel_attempt(p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a exam_attempts%rowtype;
  v_answered int;
begin
  if auth.uid() is null then
    return jsonb_build_object('ok', false, 'error', 'NOT_AUTHENTICATED');
  end if;
  select * into a from exam_attempts where id = p_attempt for update;
  if not found or a.user_id <> auth.uid() then
    return jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  end if;
  if a.status <> 'in_progress' then
    return jsonb_build_object('ok', false, 'error', 'ATTEMPT_CLOSED');
  end if;

  select count(*) into v_answered from attempt_answers
   where attempt_id = a.id and selected_option_id is not null;

  perform public.write_audit('attempt.cancel', 'exam_attempt', a.id::text,
    jsonb_build_object('course_id', a.course_id, 'mode', a.mode, 'domain_id', a.domain_id,
                       'subject_area', a.subject_area, 'question_count', a.question_count,
                       'answered', v_answered, 'started_at', a.started_at));

  -- answers first, while the attempt is still in progress (the finalized-answer guard checks it)
  delete from attempt_answers where attempt_id = a.id;
  delete from exam_attempts where id = a.id;   -- cascades to attempt_questions and performance rows
  return jsonb_build_object('ok', true, 'attempt_id', a.id);
end $$;

revoke execute on function public.cancel_attempt(uuid) from public, anon;
grant execute on function public.cancel_attempt(uuid) to authenticated;
