-- Rota Facil - controle de atualizacoes (somente administradores autorizados)
-- ANTES DE EXECUTAR: substitua SEU_EMAIL_AQUI pelo email de login do administrador.
BEGIN;
CREATE TABLE IF NOT EXISTS public.app_atualizacoes_admin (
  usuario_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.app_atualizacoes_admin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_atualizacoes_admin FROM anon, authenticated;

INSERT INTO public.app_atualizacoes_admin(usuario_id)
SELECT id FROM auth.users WHERE lower(email)=lower('SEU_EMAIL_AQUI')
ON CONFLICT (usuario_id) DO NOTHING;

DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM auth.users WHERE lower(email)=lower('SEU_EMAIL_AQUI')) THEN
   RAISE EXCEPTION 'Email de administrador nao encontrado. Substitua SEU_EMAIL_AQUI antes de executar.';
 END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rota_e_admin_atualizacoes()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO ''
AS $$ SELECT EXISTS(SELECT 1 FROM public.app_atualizacoes_admin WHERE usuario_id=(SELECT auth.uid())); $$;
REVOKE ALL ON FUNCTION public.rota_e_admin_atualizacoes() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rota_e_admin_atualizacoes() TO authenticated;

CREATE TABLE IF NOT EXISTS public.app_atualizacoes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 aplicativo text NOT NULL CHECK (aplicativo IN ('master','funcionario')),
 versao text NOT NULL,
 version_code bigint NOT NULL CHECK (version_code>0),
 canal text NOT NULL CHECK (canal IN ('teste','producao')),
 obrigatoria boolean NOT NULL DEFAULT false,
 notas text NOT NULL DEFAULT '',
 arquivo_path text NOT NULL UNIQUE,
 tamanho_bytes bigint NOT NULL CHECK (tamanho_bytes>0),
 publicada_em timestamptz NOT NULL DEFAULT now(),
 UNIQUE(aplicativo,version_code)
);
ALTER TABLE public.app_atualizacoes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_atualizacoes FROM anon;
GRANT SELECT, INSERT ON public.app_atualizacoes TO authenticated;
DROP POLICY IF EXISTS app_atualizacoes_admin_select ON public.app_atualizacoes;
CREATE POLICY app_atualizacoes_admin_select ON public.app_atualizacoes FOR SELECT TO authenticated
 USING ((SELECT public.rota_e_admin_atualizacoes()));
DROP POLICY IF EXISTS app_atualizacoes_admin_insert ON public.app_atualizacoes;
CREATE POLICY app_atualizacoes_admin_insert ON public.app_atualizacoes FOR INSERT TO authenticated
 WITH CHECK ((SELECT public.rota_e_admin_atualizacoes()));

INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES ('rota-facil-apks','rota-facil-apks',false,104857600,ARRAY['application/vnd.android.package-archive','application/octet-stream'])
ON CONFLICT (id) DO UPDATE SET public=false,file_size_limit=104857600,
 allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS rota_apks_admin_read ON storage.objects;
CREATE POLICY rota_apks_admin_read ON storage.objects FOR SELECT TO authenticated
 USING (bucket_id='rota-facil-apks' AND (SELECT public.rota_e_admin_atualizacoes()));
DROP POLICY IF EXISTS rota_apks_admin_upload ON storage.objects;
CREATE POLICY rota_apks_admin_upload ON storage.objects FOR INSERT TO authenticated
 WITH CHECK (bucket_id='rota-facil-apks' AND (SELECT public.rota_e_admin_atualizacoes())
 AND name ~ '^(master|funcionario)/[0-9a-f-]+[.]apk$');
DROP POLICY IF EXISTS rota_apks_admin_remove ON storage.objects;
CREATE POLICY rota_apks_admin_remove ON storage.objects FOR DELETE TO authenticated
 USING (bucket_id='rota-facil-apks' AND (SELECT public.rota_e_admin_atualizacoes()));
COMMIT;
