-- EXECUTE NO SUPABASE SQL EDITOR ANTES DE PUBLICAR O PAINEL V0.3.45
-- Cria novo motoboy com usuario/senha SEM gerar codigo de ativacao.
-- Nao altera nenhum dos seis motoboys existentes, senhas, aparelhos, corridas ou financeiro.
CREATE OR REPLACE FUNCTION public.rota_cadastrar_motoboy_login(
 p_empresa uuid,p_nome text,p_usuario text,p_senha text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_id uuid; v_nome text; v_usuario text;
BEGIN
 IF auth.uid() IS NULL OR NOT EXISTS (
  SELECT 1 FROM public.membros m WHERE m.usuario_id=auth.uid()
   AND m.empresa_id=p_empresa AND m.ativo=true AND m.papel='proprietario'
 ) THEN RAISE EXCEPTION 'Sem permissao para cadastrar motoboy'; END IF;
 v_nome=btrim(coalesce(p_nome,''));v_usuario=lower(btrim(coalesce(p_usuario,'')));
 IF length(v_nome)<2 OR length(v_nome)>100 THEN RAISE EXCEPTION 'Nome invalido'; END IF;
 IF v_usuario !~ '^[a-z0-9._-]{3,80}$' THEN RAISE EXCEPTION 'Usuario invalido'; END IF;
 IF p_senha IS NULL OR length(p_senha)<8 OR length(p_senha)>72 THEN RAISE EXCEPTION 'Senha deve ter entre 8 e 72 caracteres'; END IF;
 IF EXISTS (SELECT 1 FROM public.motoboys WHERE lower(nome_usuario)=v_usuario) THEN
  RAISE EXCEPTION 'Usuario ja cadastrado';
 END IF;
 v_id=gen_random_uuid();
 INSERT INTO public.motoboys(id,empresa_id,nome,nome_usuario,ativo,primeiro_acesso_concluido)
 VALUES(v_id,p_empresa,v_nome,v_usuario,true,false);
 INSERT INTO public.acessos_motoboy(motoboy_id,empresa_id,senha_hash,dispositivo_hash,ativo,senha_nova_hash,senha_atualizada_em)
 VALUES(v_id,p_empresa,
  extensions.crypt(encode(gen_random_bytes(32),'hex'),extensions.gen_salt('bf',10)),
  encode(extensions.digest(gen_random_bytes(32),'sha256'),'hex'),true,
  extensions.crypt(p_senha,extensions.gen_salt('bf',10)),now());
 RETURN jsonb_build_object('ok',true,'motoboy_id',v_id,'usuario',v_usuario);
END $$;
REVOKE ALL ON FUNCTION public.rota_cadastrar_motoboy_login(uuid,text,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.rota_cadastrar_motoboy_login(uuid,text,text,text) TO authenticated;
