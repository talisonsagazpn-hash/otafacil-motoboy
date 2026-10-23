-- Rota Facil V0.3.39 - exclusao logica, auditavel e isolada por empresa/motoboy.
-- Execute no SQL Editor do Supabase ANTES de publicar o painel.
CREATE TABLE IF NOT EXISTS public.rota_corridas_removidas (
 empresa_id uuid NOT NULL,
 motoboy_id uuid NOT NULL,
 registro_id text NOT NULL,
 pedido_id text,
 motivo text NOT NULL,
 removido_por uuid NOT NULL,
 removido_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY (empresa_id,motoboy_id,registro_id)
);
CREATE INDEX IF NOT EXISTS rota_corridas_removidas_pedido_idx
 ON public.rota_corridas_removidas(empresa_id,motoboy_id,pedido_id);
ALTER TABLE public.rota_corridas_removidas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.rota_corridas_removidas FROM anon,authenticated;
GRANT SELECT ON public.rota_corridas_removidas TO authenticated;
DROP POLICY IF EXISTS rota_corridas_removidas_leitura ON public.rota_corridas_removidas;
CREATE POLICY rota_corridas_removidas_leitura ON public.rota_corridas_removidas
 FOR SELECT TO authenticated USING (
 EXISTS (SELECT 1 FROM public.membros m WHERE m.usuario_id=(SELECT auth.uid())
 AND m.empresa_id=rota_corridas_removidas.empresa_id AND m.ativo=true
 AND m.papel IN ('proprietario','gerente','atendente'))
 );
CREATE OR REPLACE FUNCTION public.rota_remover_corrida_financeira(
 p_empresa uuid,p_motoboy uuid,p_registro text,p_pedido text,p_motivo text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_pedido text;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.membros m WHERE m.usuario_id=(SELECT auth.uid())
   AND m.empresa_id=p_empresa AND m.ativo=true AND m.papel='proprietario') THEN
   RAISE EXCEPTION 'Apenas o proprietario pode remover corridas';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.motoboys m WHERE m.id=p_motoboy AND m.empresa_id=p_empresa) THEN
   RAISE EXCEPTION 'Motoboy nao pertence a empresa';
 END IF;
 IF p_registro IS NULL OR p_motivo IS NULL OR length(trim(p_motivo))<3 THEN
   RAISE EXCEPTION 'Identificador e motivo obrigatorios';
 END IF;
 IF left(p_registro,10)='historico:' THEN
   SELECT nullif(h.dados->>'remotePedidoId','') INTO v_pedido
   FROM public.historico_entregas_motoboy h
   WHERE h.empresa_id=p_empresa AND h.motoboy_id=p_motoboy
     AND h.local_id=substr(p_registro,11) AND h.excluido_em IS NULL;
   IF NOT FOUND THEN RAISE EXCEPTION 'Corrida historica nao encontrada ou ja removida'; END IF;
 ELSIF left(p_registro,11)='financeiro:' THEN
   v_pedido=substr(p_registro,12);
   IF NOT EXISTS(SELECT 1 FROM public.financeiro_corridas_motoboy f
      WHERE f.empresa_id=p_empresa AND f.motoboy_id=p_motoboy
      AND f.pedido_id::text=v_pedido) THEN
      RAISE EXCEPTION 'Lancamento financeiro nao encontrado';
   END IF;
 ELSE RAISE EXCEPTION 'Tipo de registro invalido'; END IF;
 IF p_pedido IS NOT NULL AND v_pedido IS NOT NULL AND p_pedido<>v_pedido THEN
   RAISE EXCEPTION 'Pedido informado nao confere';
 END IF;
 INSERT INTO public.rota_corridas_removidas(empresa_id,motoboy_id,registro_id,pedido_id,motivo,removido_por)
 VALUES(p_empresa,p_motoboy,p_registro,v_pedido,p_motivo,(SELECT auth.uid()))
 ON CONFLICT(empresa_id,motoboy_id,registro_id) DO NOTHING;
 IF left(p_registro,10)='historico:' THEN
   UPDATE public.historico_entregas_motoboy h SET excluido_em=now(),exclusao_motivo=p_motivo
   WHERE h.empresa_id=p_empresa AND h.motoboy_id=p_motoboy AND h.local_id=substr(p_registro,11);
 END IF;
END;$$;
REVOKE ALL ON FUNCTION public.rota_remover_corrida_financeira(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rota_remover_corrida_financeira(uuid,uuid,text,text,text) TO authenticated;
