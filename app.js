'use strict';
/* Rota Fácil Web — integração com as mesmas RPCs do Android FUNCIONÁRIO.
   Nunca armazenar service_role no navegador. */
const cfg=window.ROTA_CONFIG;
const $=id=>document.getElementById(id);
const storeKey='rotafacil_web_iphone_v1';
let state={device:'',proof:'',pendingId:'',session:'',operational:'',driver:'',company:''};
let gpsWatch=null,gpsTimer=null,gpsLastSent=0,gpsSending=false,gpsLastFix=null,gpsOnline=false;let routes=[],statuses=new Map(),payments=new Map(),history=[],finance=[],lastPosition=null,loading=false,refreshTimer=null;
try{state={...state,...JSON.parse(localStorage.getItem(storeKey)||'{}')}}catch{}
const save=()=>localStorage.setItem(storeKey,JSON.stringify(state));
function randomHex(){const a=crypto.getRandomValues(new Uint8Array(32));return [...a].map(x=>x.toString(16).padStart(2,'0')).join('')}
if(!/^[a-f0-9]{64}$/.test(state.device)){state.device=randomHex();save()}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n)||0);
const date=s=>{if(!s)return '—';const d=new Date(s);return isNaN(d)?'—':d.toLocaleString('pt-BR')};
const notice=(m)=>{const el=$('notice');el.textContent=m;el.classList.add('visible');clearTimeout(notice.t);notice.t=setTimeout(()=>el.classList.remove('visible'),5500)};
function errorMessage(err){return err instanceof Error?err.message:String(err)}
async function request(path,body,edge=false){
 const url=`${cfg.supabaseUrl}/${edge?'functions/v1':'rest/v1/rpc'}/${path}`;
 const r=await fetch(url,{method:'POST',headers:{'apikey':cfg.publishableKey,'Authorization':`Bearer ${cfg.publishableKey}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store'});
 const txt=await r.text();let obj;try{obj=JSON.parse(txt)}catch{throw Error(`Resposta inválida (${r.status})`)}
 if(!r.ok)throw Error(obj.erro||obj.error||obj.mensagem||obj.message||`HTTP ${r.status}`);
 return obj;
}
const edge=(name,body)=>request(name,body,true);
const rpc=(name,body)=>request(name,body);
function setConnection(text){$('connection').textContent=text}
function showApp(){ $('auth').classList.add('hidden');$('app').classList.remove('hidden');$('driverName').textContent=state.driverName||'Motoboy';$('welcome').textContent='Bem-vindo, '+(state.driverName||'motoboy')+' • suas rotas e resultados';startRefresh()}
function showLogin(){ $('auth').classList.remove('hidden');$('app').classList.add('hidden');$('pendingBox').classList.toggle('hidden',!state.pendingId);if(state.pendingId)$('pendingText').textContent='Aguardando aprovação da loja. Após aprovar, toque em Consultar aprovação.'}
async function login(ev){
 ev.preventDefault();const user=$('username').value.trim().toLowerCase(),pass=$('password').value;
 if(!/^[a-z0-9._-]{3,80}$/.test(user)||pass.length<8||pass.length>72){notice('Confira usuário e senha.');return}
 $('loginBtn').disabled=true;
 try{
  const check=await edge('rota-login-motoboy',{acao:'verificar_login',usuario:user,senha:pass});
  if(!check.valido)throw Error('Usuário ou senha inválidos');
  state.proof=randomHex();
  const r=await edge('rota-login-motoboy',{acao:'solicitar_acesso',usuario:user,senha:pass,dispositivo:state.device,comprovante:state.proof});
  state.pendingId=r.solicitacao_id;save();showLogin();notice('Solicitação enviada. Peça à loja para aprovar o iPhone no painel.');
 }catch(e){notice('Falha no acesso: '+errorMessage(e))}finally{$('loginBtn').disabled=false}
}
async function approve(){
 $('approveBtn').disabled=true;
 try{
  if(!state.pendingId||!state.proof)throw Error('Solicite autorização primeiro');
  const r=await edge('rota-login-motoboy',{acao:'ativar_acesso',solicitacao_id:state.pendingId,comprovante:state.proof});
  if(r.status!=='ativo'){notice('Situação: '+(r.status||'aguardando'));return}
  state.session=r.token_sessao;state.driver=r.motoboy_id;state.company=r.empresa_id;state.driverName=r.nome||'Motoboy';state.pendingId='';state.proof='';save();
  await enableOperations();showApp();startGps();await refresh();
 }catch(e){notice('Não foi possível concluir: '+errorMessage(e))}finally{$('approveBtn').disabled=false}
}
async function validateSession(){
 if(!state.session)return false;
 const r=await edge('rota-login-motoboy',{acao:'validar_sessao',token_sessao:state.session,dispositivo:state.device});
 if(!r.ok)throw Error('Sessão não autorizada ou expirada');
 state.driver=r.motoboy_id;state.company=r.empresa_id;state.driverName=r.nome||'Motoboy';save();return true;
}
async function enableOperations(){
 if(!state.session)throw Error('Sessão não encontrada');
 if(!/^[a-f0-9]{64}$/.test(state.operational)){state.operational=randomHex();save()}
 const r=await edge('rota-habilitar-operacoes',{token_sessao:state.session,dispositivo:state.device,token_operacional:state.operational});
 if(!r.ok)throw Error(r.erro||'Operações não autorizadas');
 state.driver=r.motoboy_id;state.company=r.empresa_id;save();return r;
}
async function resume(){
 if(!state.session){showLogin();return}
 setConnection('Validando...');
 try{await validateSession();await enableOperations();showApp();startGps();await refresh()}
 catch(e){showLogin();setConnection('Acesso pendente');notice('Sessão: '+errorMessage(e))}
}
async function refresh(){
 if(loading||!state.operational)return;
 loading=true;setConnection('Sincronizando...');
 try{
  // Chamadas independentes: falha no financeiro não deve apagar rotas.
  const jobs=[
   rpc('rota_receber_despachos',{p_dispositivo:state.operational}),
   rpc('rota_pagamentos_motoboy',{p_dispositivo:state.operational}),
   rpc('rota_historico_financeiro_motoboy',{p_dispositivo:state.operational}),
   rpc('rota_financeiro_app_motoboy',{p_dispositivo:state.operational})
  ];
  const result=await Promise.allSettled(jobs);
  let ok=0;
  if(result[0].status==='fulfilled'){
   const payload=result[0].value;
   if(payload.ok===false)throw Error(payload.erro||'Despacho recusado');
   const raw=Array.isArray(payload.rotas)?payload.rotas:[];
   routes=raw.flatMap(r=>(Array.isArray(r.pedidos)?r.pedidos:[]).map(p=>({...p,rota_id:r.rota_id})));
   ok++;
  }
  if(result[1].status==='fulfilled'){payments=new Map((result[1].value.pagamentos||[]).map(p=>[p.pedido_id,p]));ok++}
  if(result[2].status==='fulfilled'){history=Array.isArray(result[2].value.corridas)?result[2].value.corridas:[];ok++}
  if(result[3].status==='fulfilled'){const d=result[3].value;finance=Array.isArray(d.corridas)?d.corridas:Array.isArray(d.registros)?d.registros:[];ok++}
  if(!ok)throw Error(result[0].reason?.message||'Não foi possível consultar o Supabase');
  render();setConnection(ok===4?'Sincronizado':'Parcial');$('routeStatus').textContent=`Última consulta: ${new Date().toLocaleTimeString('pt-BR')} • ${ok}/4 fontes`;if(ok<4){const names=['Despachos','Pagamentos','Histórico','Financeiro'];const errs=result.map((r,i)=>r.status==='rejected'?`${names[i]}: ${errorMessage(r.reason)}`:null).filter(Boolean);$('syncErrors').textContent=errs.join(' | ')}else $('syncErrors').textContent='';
 }catch(e){setConnection('Sem conexão');$('routeStatus').textContent='Não foi possível atualizar. Os dados anteriores permanecem na tela.';notice(errorMessage(e))}
 finally{loading=false}
}
function firstField(o,...keys){for(const k of keys){const v=o?.[k];if(v!==undefined&&v!==null&&String(v).trim()!=='')return v}return null}
function currentStatus(p){const s=statuses.get(p.pedido_id);return s?.status||p.status||'em_rota'}
function currentResult(p){return statuses.get(p.pedido_id)?.resultado||''}
function render(){
 const active=routes.filter(p=>['em_rota','pendente'].includes(currentStatus(p)));
 $('metricRoutes').textContent=String(active.length);$('homeActive').textContent=String(active.length);
 const dashboardRecords=finance.length?finance:history;
 $('metricTrips').textContent=String(dashboardRecords.length);
 $('metricMoney').textContent=money(dashboardRecords.reduce((v,r)=>v+(Number(r.valor??r.remuneracao)||0),0));const normalized=dashboardRecords.map(r=>String(r.resultado||r.tipo||r.status||'').toLowerCase());$('homeDelivered').textContent=String(normalized.filter(x=>x.includes('entreg')).length);$('homeCancelled').textContent=String(normalized.filter(x=>x.includes('cancel')).length);$('moreDriver').textContent=state.driverName||'Motoboy';
 $('routeList').innerHTML=active.length?active.map((p,i)=>{
 const pay=payments.get(p.pedido_id)||{},payment=pay.pagamento_status==='cobrar'?`Cobrar do cliente • ${esc(pay.pagamento_forma||'')} ${pay.pagamento_valor!=null?money(pay.pagamento_valor):''}`:pay.pagamento_status==='pago'?'Pagamento online realizado':'';
 return `<article class="card"><div class="route-title"><h3>${i+1}. Pedido #${esc(p.numero||'—')}</h3><span class="badge">Em rota</span></div>
 <p><strong>${esc(p.cliente||p.cliente_nome||'Cliente')}</strong><br>${esc(p.endereco||'Endereço não informado')}</p>
 ${p.complemento?`<p>Complemento: ${esc(p.complemento)}</p>`:''}
 ${p.referencia?`<p>Referência: ${esc(p.referencia)}</p>`:''}
 ${payment?`<p class="muted">${payment}</p>`:''}
 <p class="value">Corrida: ${money(p.taxa_motoboy??10)}</p>
 <div class="actions"><button class="secondary" data-action="map" data-id="${esc(p.pedido_id)}">Iniciar navegação</button>
 <button class="secondary" data-action="arrive" data-id="${esc(p.pedido_id)}">Cheguei</button>
 <button data-action="deliver" data-id="${esc(p.pedido_id)}">Finalizar entrega</button>
 <button class="secondary" data-action="cancel" data-id="${esc(p.pedido_id)}">Cancelar</button></div></article>`
 }).join(''):'<div class="card muted">Nenhuma rota ativa atribuída pelo estabelecimento.</div>';
 const records=history.length?history:finance;
 $('historyList').innerHTML=records.length?records.slice(0,250).map(r=>{
 const type=String(r.resultado||r.tipo||r.status||'');
 return `<article class="card"><div class="route-title"><strong>#${esc(firstField(r,'pedido_numero','numero','numero_pedido','pedido')||'não informado')} • ${esc(firstField(r,'cliente','cliente_nome','nome_cliente','nome')||'Cliente não informado pelo servidor')}</strong><span class="badge ${type.includes('cancel')?'cancel':''}">${esc(type==='cancelado_pago'||type==='cancelada'?'Cancelada remunerada':type==='entregue'?'Entregue':type||'Registrado')}</span></div><p class="value">${money(r.valor??r.remuneracao??0)}</p><small>${esc(date(firstField(r,'finalizado_em','data_finalizacao','registrado_em','data')))}</small></article>`
 }).join(''):'<div class="card muted">Nenhum registro retornado pelo Supabase.</div>';
 const f=finance.length?finance:history;
 const total=f.reduce((s,r)=>s+(Number(r.valor??r.remuneracao)||0),0);
 $('financeSummary').innerHTML=`<div class="summary"><small>Total dos ${f.length} registros retornados pelo Supabase</small><strong>${money(total)}</strong><p class="hint">Não é fechamento de ciclo. O valor mostrado depende do período e dos registros retornados pela RPC.</p></div>`;
 const weekStart=new Date();weekStart.setHours(0,0,0,0);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));
 const days=Array.from({length:7},(_,i)=>({label:['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'][i],amount:0}));
 let undated=0;
 f.forEach(r=>{const raw=r.finalizado_em||r.registrado_em||r.data_finalizacao||r.data;const dt=raw?new Date(raw):null;if(!dt||Number.isNaN(dt.getTime())){undated++;return}const day=new Date(dt);day.setHours(0,0,0,0);const index=Math.round((day-weekStart)/86400000);if(index>=0&&index<7)days[index].amount+=Number(r.valor??r.remuneracao)||0});
 const max=Math.max(1,...days.map(x=>x.amount));
 $('financeChart').innerHTML=days.map(g=>`<div class="chart-col"><strong>${money(g.amount)}</strong><div class="chart-bar" style="height:${Math.max(4,Math.round(g.amount/max*125))}px"></div><small>${g.label}</small></div>`).join('');
 $('financeSummary').innerHTML=`<div class="summary"><small>Total dos ${f.length} registros retornados pelo Supabase</small><strong>${money(total)}</strong><p class="hint">Gráfico: semana atual (segunda a domingo), pela data de finalização disponível. ${undated?undated+' registro(s) sem data não aparecem no gráfico.':''} Não representa necessariamente o fechamento do ciclo.</p></div>`;
 $('financeList').innerHTML=f.slice(0,100).map(r=>`<article class="card"><strong>${esc(firstField(r,'pedido_numero','numero','numero_pedido')||'Corrida')}</strong> • ${esc(r.tipo||r.resultado||'')} <span class="value">${money(r.valor??r.remuneracao??0)}</span></article>`).join('');
}
function findOrder(id){return routes.find(p=>p.pedido_id===id)}
function distance(a,b,c,d){const R=6371000,toRad=x=>x*Math.PI/180,x1=toRad(c-a),x2=toRad(d-b);return 2*R*Math.asin(Math.sqrt(Math.sin(x1/2)**2+Math.cos(toRad(a))*Math.cos(toRad(c))*Math.sin(x2/2)**2))}
async function locate(){if(!navigator.geolocation)throw Error('GPS indisponível');return new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(p=>{lastPosition=p.coords;$('locText').textContent=`Precisão aproximada: ${Math.round(p.coords.accuracy)} m • ${new Date().toLocaleTimeString('pt-BR')}`;resolve(p.coords)},e=>reject(Error('GPS: '+e.message)),{enableHighAccuracy:true,timeout:18000,maximumAge:0}))}
async function verifyDistance(p){
 const lat=Number(p.latitude),lon=Number(p.longitude);
 if(!p.latitude||!p.longitude||!Number.isFinite(lat)||!Number.isFinite(lon))throw Error('Pedido sem coordenadas. Peça ao estabelecimento para confirmar a entrega pelo painel.');
 const loc=await locate(),meters=distance(loc.latitude,loc.longitude,lat,lon);
 if(loc.accuracy>100)throw Error('Precisão do GPS insuficiente. Aguarde e tente novamente.');
 if(meters>cfg.maxDeliveryDistanceMeters)throw Error(`Você está a ${Math.round(meters)} m do endereço. Limite: ${cfg.maxDeliveryDistanceMeters} m. Peça confirmação pelo painel se necessário.`);
}
async function action(id,kind){
 const p=findOrder(id);if(!p)return;
 if(kind==='map'){
 const q=p.latitude&&p.longitude?`${p.latitude},${p.longitude}`:p.endereco||'';
 if(!q){notice('Endereço não disponível para navegação.');return}
 const maps='https://www.google.com/maps/dir/?api=1&destination='+encodeURIComponent(q);
 const waze='https://waze.com/ul?'+(p.latitude&&p.longitude?'ll='+encodeURIComponent(`${p.latitude},${p.longitude}`):'q='+encodeURIComponent(q))+'&navigate=yes';
 const choice=window.prompt('Escolha o navegador: 1 - Google Maps | 2 - Waze','1');
 if(choice==='1'||choice==='2')window.open(choice==='1'?maps:waze,'_blank','noopener');return
 }
 if(kind==='arrive'){
  // Chegada no web não é uma RPC de finalização. Nunca marcar entregue sem confirmação do servidor.
  const locator=firstField(p,'localizador','codigo_localizador','codigo_confirmacao','codigo_entrega');
  const provider=String(firstField(p,'plataforma','origem','integracao','app_origem')||'').toLowerCase();
  const candidate=firstField(p,'url_confirmacao','link_confirmacao','link_confirmar','url_confirmar','confirmacao_url');
  let link='';
  if(candidate){try{const u=new URL(String(candidate));if(u.protocol==='https:'&&['food-b-h5.99app.com','www.ifood.com.br','ifood.com.br'].includes(u.hostname))link=u.href}catch{}}
  if(!link&&provider.includes('99'))link='https://food-b-h5.99app.com/pt-BR/v2/confirmation-entrega';
  if(!locator){notice('Pedido sem localizador retornado pelo painel. Não é possível copiar automaticamente.');return}
  if(!link){notice('Localizador encontrado, mas o pedido não trouxe link de confirmação confiável.');return}
  // Clipboard exige HTTPS e gesto do usuário; abrir página depois de copiar.
  try{await navigator.clipboard.writeText(String(locator));notice('Localizador '+locator+' copiado. Abrindo confirmação...')}
  catch(e){notice('Não foi possível copiar automaticamente. Localizador: '+locator+' — copie manualmente antes de confirmar.')}
  window.open(link,'_blank','noopener');return
 }
 if(!['deliver','cancel'].includes(kind))return;
 const msg=kind==='deliver'?'Confirmar que este pedido foi entregue?':'Cancelar este pedido sem remuneração? Cancelamento remunerado deve ser realizado pelo estabelecimento.';
 if(!confirm(msg))return;
 const btn=document.querySelector(`[data-id="${CSS.escape(id)}"][data-action="${kind}"]`);
 if(btn)btn.disabled=true;
 try{
  if(kind==='deliver')await verifyDistance(p);
  const r=await rpc('rota_registrar_resultado_motoboy',{p_dispositivo:state.operational,p_pedido_id:id,p_rota_id:p.rota_id,p_status:kind==='deliver'?'entregue':'cancelado',p_finalizado_em:new Date().toISOString()});
  if(r.ok===false)throw Error(r.erro||'Servidor não confirmou a operação');
  notice('Operação confirmada no Supabase');await refresh();
 }catch(e){notice('Não finalizado: '+errorMessage(e))}
 finally{if(btn)btn.disabled=false}
}
function presence(on,details){
 gpsOnline=on;
 const e=$('onlineIndicator');e.classList.toggle('online',on);e.classList.toggle('offline',!on);e.innerHTML=`<span class="dot"></span> ${on?'Online':'Offline'}`;
 $('gpsMini').textContent=details||(on?'Localização enviada ao painel':'GPS não sincronizado');
 $('gpsToggle').textContent=on?'GPS ativo':'Ativar GPS';
}
async function sendGps(coords){
 if(!state.operational||gpsSending||document.hidden||Date.now()-gpsLastSent<12000)return;
 gpsSending=true;
 try{
  const result=await rpc('rota_localizar_aparelho',{p_dispositivo:state.operational,p_latitude:coords.latitude,p_longitude:coords.longitude,p_compartilhando:true});
  if(result.ok===false)throw Error(result.erro||'GPS recusado pelo Supabase');
  gpsLastSent=Date.now();presence(true,`Enviado às ${new Date().toLocaleTimeString('pt-BR')} • precisão ${Math.round(coords.accuracy)} m`);
 }catch(e){presence(false,'Falha ao sincronizar GPS: '+errorMessage(e))}
 finally{gpsSending=false}
}
function startGps(){
 if(!state.operational){notice('Faça login e autorize as operações antes de ativar o GPS.');return}
 if(!navigator.geolocation){notice('GPS não disponível neste navegador.');return}
 if(gpsWatch!==null)return;
 gpsWatch=navigator.geolocation.watchPosition(pos=>{
  gpsLastFix=pos.coords;
  $('locText').textContent=`Precisão aproximada: ${Math.round(pos.coords.accuracy)} m • ${new Date().toLocaleTimeString('pt-BR')}`;
  sendGps(pos.coords);
 },err=>{presence(false,'GPS: '+err.message);notice('GPS: '+err.message)}, {enableHighAccuracy:true,maximumAge:10000,timeout:20000});
 gpsTimer=setInterval(()=>{if(!document.hidden&&gpsLastFix)sendGps(gpsLastFix)},15000);
 $('gpsMini').textContent='Aguardando GPS e confirmação do servidor...';
}
function stopGps(){
 if(gpsWatch!==null)navigator.geolocation.clearWatch(gpsWatch);
 gpsWatch=null;clearInterval(gpsTimer);gpsTimer=null;gpsLastFix=null;
 presence(false,'GPS pausado neste navegador; status do painel pode demorar a expirar');
}
function startRefresh(){if(refreshTimer)clearInterval(refreshTimer);refreshTimer=setInterval(()=>{if(!document.hidden)refresh()},Math.max(10,cfg.refreshSeconds)*1000)}
$('loginForm').addEventListener('submit',login);
$('approveBtn').addEventListener('click',approve);
$('refreshBtn').addEventListener('click',refresh);$('moreRefresh').addEventListener('click',refresh);$('homeSync').addEventListener('click',refresh);$('historySync').addEventListener('click',refresh);$('financeSync').addEventListener('click',refresh);$('homeRoutes').addEventListener('click',()=>document.querySelector('[data-tab=routes]').click());
$('locBtn').addEventListener('click',async()=>{try{const coords=await locate();await sendGps(coords)}catch(e){notice(errorMessage(e))}});
$('gpsToggle').addEventListener('click',()=>{if(gpsWatch===null)startGps();else stopGps()});
$('locStopBtn').addEventListener('click',stopGps);
$('logoutBtn').addEventListener('click',()=>{if(!confirm('Sair deste iPhone? Será necessário solicitar autorização novamente.'))return;stopGps();localStorage.removeItem(storeKey);location.reload()});
document.querySelectorAll('[data-tab]').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('[data-tab]').forEach(x=>x.classList.toggle('active',x===b));document.querySelectorAll('.view').forEach(v=>v.classList.toggle('hidden',v.id!==b.dataset.tab))}));
$('routeList').addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(b)action(b.dataset.id,b.dataset.action)});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.session){refresh();if(gpsLastFix)sendGps(gpsLastFix)}else if(document.hidden)presence(false,'Em segundo plano: envio de GPS não garantido')});
resume();
