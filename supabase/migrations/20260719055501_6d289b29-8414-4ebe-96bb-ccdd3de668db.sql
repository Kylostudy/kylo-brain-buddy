CREATE INDEX IF NOT EXISTS idx_audit_qa_coverage_diff_lookup
  ON public.audit_qa_coverage (tenant_id, screenshot_hash, url, language, skin, visited_at DESC)
  WHERE screenshot_hash IS NOT NULL;