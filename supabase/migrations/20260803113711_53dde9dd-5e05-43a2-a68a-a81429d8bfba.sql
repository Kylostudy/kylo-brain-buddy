-- 1. Real role storage
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','platform_operator','user');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read own roles" ON public.user_roles;
CREATE POLICY "Users can read own roles"
ON public.user_roles FOR SELECT TO authenticated
USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

-- 2. Fix broken operator check: require a real operator/admin role
CREATE OR REPLACE FUNCTION public.is_platform_operator()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_role(auth.uid(), 'platform_operator')
      OR public.has_role(auth.uid(), 'admin')
$$;

REVOKE ALL ON FUNCTION public.is_platform_operator() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_operator() TO authenticated, service_role;

-- Seed the existing sole account as platform operator so monitoring keeps working
INSERT INTO public.user_roles (user_id, role)
SELECT id, 'platform_operator'::public.app_role FROM auth.users
ON CONFLICT (user_id, role) DO NOTHING;

-- 3. workflow_folders INSERT must verify module entitlement
DROP POLICY IF EXISTS "Tenant can insert own folders" ON public.workflow_folders;
CREATE POLICY "Tenant can insert own folders"
ON public.workflow_folders FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.current_tenant_id()
  AND public.tenant_has_module(tenant_id, module)
);