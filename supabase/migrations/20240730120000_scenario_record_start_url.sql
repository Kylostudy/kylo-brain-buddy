-- A forgatókönyv felvétele nem a kezdőoldalról, hanem a funkciók/generálás
-- oldalról induljon: külön mezőben tároljuk a felvételi belépési pontot.
ALTER TABLE public.audit_scenarios
  ADD COLUMN IF NOT EXISTS record_start_url text;
