import {createClient} from 'https://esm.sh/@supabase/supabase-js@2';
import {SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY} from './config.js';
const sb=createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true}});
const $=id=>document.getElementById(id);const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let accessRequests=[];
let removedPedidoIds=new Set();
let state={user:null,empresa:null,lojas:[],motoboys:[],pedidos:[],rotas:[],paradas:[],localizacoes:[],page:'inicio',finance:[],selected:new Set(),map:null,markers:[],routeLines:[],focusDriver:null,autoFit:true,optimized:null,roadCache:new Map(),roadPending:new Set()};
const statusName={pendente:'Pendente',em_rota:'Em rota',entregue:'Entregue',cancelado:'Cancelado',rascunho:'Rascunho',enviada:'Enviada',em_andamento:'Em andamento',concluida:'Concluída',cancelada:'Cancelada'};
const badge=s=>`<span class="status ${esc(s)}">${esc(statusName[s]||s)}</span>`;
const fmt=d=>d?new Date(d).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
const brDateKey=d=>{const date=new Date(d);if(!Number.isFinite(date.getTime()))return '';return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(date)};
function toast(t,bad=false){const el=$('toast');el.textContent=t;el.style.display='block';el.style.borderColor=bad?'#b34c52':'#2b7c4d';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',5000)}
function errorText(e){return e?.message||String(e)}
async function fetchAll(){if(!state.empresa)return;const eid=state.empresa.id;const queries=await Promise.all([
 sb.from('lojas').select('*').eq('empresa_id',eid).order('criada_em'),sb.from('motoboys').select('*').eq('empresa_id',eid).order('criado_em'),sb.from('pedidos').select('*').eq('empresa_id',eid).order('criado_em',{ascending:false}).limit(500),sb.from('rotas').select('*').eq('empresa_id',eid).order('criada_em',{ascending:false}).limit(150),sb.from('rota_paradas').select('*').eq('empresa_id',eid).limit(1000),sb.from('localizacoes_motoboy').select('*').eq('empresa_id',eid),sb.from('rota_corridas_removidas').select('pedido_id').eq('empresa_id',eid)]);
 const names=['lojas','motoboys','pedidos','rotas','paradas','localizacoes','removidos'];let err=[];queries.forEach((r,i)=>{if(r.error)err.push(`${names[i]}: ${r.error.message}`);else if(i===6)removedPedidoIds=new Set((r.data||[]).map(x=>x.pedido_id).filter(Boolean));else state[names[i]]=r.data||[]});if(!queries[6].error){state.pedidos=state.pedidos.filter(p=>!removedPedidoIds.has(p.id));state.paradas=state.paradas.filter(p=>!removedPedidoIds.has(p.pedido_id));}$('connection').textContent=err.length?'● Erro de conexão':'● Conectado';if(err.length)toast(err.join(' | '),true);render();if(state.page==='financeiro')loadFinance();if(state.page==='motoboys')loadAccessRequests()}
async function start(){
 if(recoveryMode)return;
 const {data:authData,error:authError}=await sb.auth.getUser();
 const user=authData?.user;
 if(authError||!user){
  state.user=null;state.empresa=null;
  $('login').classList.remove('hidden');$('app').classList.add('hidden');
  if(authError)$('loginError').textContent='Erro de autenticação: '+errorText(authError);
  return;
 }
 state.user=user;
 // Consultas separadas: um erro de relacionamento não pode parecer ausência de cadastro.
 const membership=await sb.from('membros').select('empresa_id,papel,ativo')
   .eq('usuario_id',user.id).eq('ativo',true)
   .in('papel',['proprietario','gerente','atendente']).limit(1);
 if(membership.error){
  showAccessError('Erro ao consultar seu vínculo com a empresa: '+errorText(membership.error));
  return;
 }
 if(!membership.data?.length){
  showAccessError('Não foi encontrado vínculo ativo com permissão de acesso para esta conta. Confirme que entrou com o mesmo e-mail cadastrado na Empresa Piloto.');
  return;
 }
 const member=membership.data[0];
 const company=await sb.from('empresas').select('id,nome').eq('id',member.empresa_id).maybeSingle();
 if(company.error){
  showAccessError('Seu vínculo foi encontrado, mas não foi possível consultar a empresa: '+errorText(company.error));
  return;
 }
 if(!company.data){
  showAccessError('Seu vínculo foi encontrado, mas a empresa não está visível para sua conta. Verifique as políticas de leitura da tabela empresas.');
  return;
 }
 state.empresa=company.data;state.papel=member.papel;
 $('loginError').textContent='';
 $('companyName').textContent=state.empresa.nome;
 $('userName').textContent=user.email||'Administrador';
 $('login').classList.add('hidden');$('app').classList.remove('hidden');
 await fetchAll();
 await checkUpdateAdmin();
 if(!start.interval)start.interval=setInterval(()=>{if(state.user&&state.empresa)fetchAll()},5000);
}
function showAccessError(message){
 state.empresa=null;
 $('login').classList.remove('hidden');$('app').classList.add('hidden');
 $('loginError').textContent=message;
 console.warn('[Rota Fácil] Acesso ao painel:',message);
}
function options(rows){return rows.map(x=>`<option value="${esc(x.id)}">${esc(x.nome)}</option>`).join('')}
function table(rows,withAction=false){if(!rows.length)return '<div class="empty">Nenhum pedido encontrado.</div>';return `<table><thead><tr><th>Pedido</th><th>Cliente</th><th>Endereço</th><th>Status</th><th>Data</th>${withAction?'<th>Ação</th>':''}</tr></thead><tbody>${rows.map(p=>`<tr><td>#${esc(p.numero||p.id.slice(0,6))}</td><td>${esc(p.cliente_nome)}</td><td>${esc(p.endereco)}</td><td>${badge(p.status)}</td><td>${fmt(p.criado_em)}</td>${withAction?`<td>${p.status==='pendente'?`<button class="secondary" data-cancel="${esc(p.id)}">Cancelar sem pagamento</button>`:state.paradas.some(st=>st.pedido_id===p.id)?`<button type="button" class="secondary" data-order-detail="${esc(p.id)}">Ver rota</button>`:'—'}</td>`:''}</tr>`).join('')}</tbody></table>`}
function driverLoc(m){return state.localizacoes.find(l=>l.motoboy_id===m.id)}
function validLoc(loc){return !!loc&&Number.isFinite(Number(loc.latitude))&&Number.isFinite(Number(loc.longitude))&&Math.abs(Number(loc.latitude))<=90&&Math.abs(Number(loc.longitude))<=180}
function gpsAge(loc){const age=Date.now()-new Date(loc?.atualizado_em).getTime();return Number.isFinite(age)?Math.max(0,Math.floor(age/1000)):Infinity}
function gpsAgeLabel(loc){const seconds=gpsAge(loc);if(!Number.isFinite(seconds))return 'sem registro';return seconds<60?`${seconds} segundos`:`${Math.floor(seconds/60)} min ${seconds%60} s`}
function driverLive(loc){return validLoc(loc)&&loc.compartilhando===true&&gpsAge(loc)<45}
function driverUnstable(loc){return validLoc(loc)&&loc.compartilhando===true&&gpsAge(loc)>=45&&gpsAge(loc)<90}
function driverStatus(loc){return driverLive(loc)?'Online':driverUnstable(loc)?'Sinal instável':validLoc(loc)?'Offline · última posição':'Sem sinal'}
function activeDriverRoutes(m){return state.rotas.filter(r=>r.motoboy_id===m.id&&['enviada','em_andamento'].includes(r.status))}
function bikeIcon(live){return L.divIcon({className:'bike-pin-container',html:`<div class="bike-pin ${live?'bike-pin-online':'bike-pin-offline'}" aria-label="Motoboy ${live?'online':'offline'}">🏍️</div>`,iconSize:[38,38],iconAnchor:[19,19],popupAnchor:[0,-18]})}
function focusDriver(id){state.focusDriver=id;state.autoFit=true;page('mapa')}
function render(){if(state.page==='financeiro')renderFinance();const today=brDateKey(new Date());const todayOrders=state.pedidos.filter(p=>brDateKey(p.criado_em)===today);$('statOrders').textContent=todayOrders.length;$('statRoad').textContent=todayOrders.filter(p=>p.status==='em_rota').length;$('statDone').textContent=todayOrders.filter(p=>p.status==='entregue').length;$('statPending').textContent=todayOrders.filter(p=>p.status==='pendente').length;$('statDrivers').textContent=state.motoboys.filter(m=>m.ativo).length;$('recentOrders').innerHTML=table(state.pedidos.slice(0,7));$('recentRoutes').innerHTML=state.rotas.filter(r=>brDateKey(r.criada_em)===today).slice(0,5).map(r=>`<div class="route-item"><div><b>Rota #${r.id.slice(0,6)}</b><small>${fmt(r.criada_em)} · ${state.paradas.filter(p=>p.rota_id===r.id).length} pedidos</small></div>${badge(r.status)}</div>`).join('')||'<div class="empty">Nenhuma rota cadastrada</div>';$('recentDrivers').innerHTML=state.motoboys.map(m=>`<div class="driver-item">🏍️ ${esc(m.nome)} <small>${m.ativo?'Ativo':'Inativo'}</small></div>`).join('')||'<div class="empty">Nenhum motoboy</div>';
const term=$('orderSearch').value.toLowerCase(),filter=$('orderFilter').value;const filtered=state.pedidos.filter(p=>(!filter||p.status===filter)&&[p.cliente_nome,p.numero,p.endereco].some(v=>String(v||'').toLowerCase().includes(term)));$('ordersTable').innerHTML=table(filtered,true);$('routeStore').innerHTML=options(state.lojas);$('orderStore').innerHTML=options(state.lojas);if($('outsideStore'))$('outsideStore').innerHTML=options(state.lojas);const previousWaStore=$('waStore').value;$('waStore').innerHTML=options(state.lojas);if(previousWaStore&&state.lojas.some(s=>s.id===previousWaStore))$('waStore').value=previousWaStore;const selectedDriver=$('routeDriver').value;const eligibleDrivers=state.motoboys.filter(m=>m.ativo&&driverLive(driverLoc(m)));$('routeDriver').innerHTML='<option value="">Selecione um motoboy online (pode estar em rota)</option>'+options(eligibleDrivers);if(eligibleDrivers.some(m=>m.id===selectedDriver))$('routeDriver').value=selectedDriver;const store=$('routeStore').value||$('routeStore').dataset.selected||state.lojas[0]?.id;if(store&&state.lojas.some(x=>x.id===store))$('routeStore').value=store;
const available=state.pedidos.filter(p=>p.status==='pendente'&&p.loja_id===$('routeStore').value);state.selected=new Set([...state.selected].filter(id=>available.some(p=>p.id===id)));$('routeCandidates').innerHTML=available.map(p=>`<label class="candidate"><input type="checkbox" data-pick="${esc(p.id)}" ${state.selected.has(p.id)?'checked':''}><div><b>#${esc(p.numero||p.id.slice(0,6))} — ${esc(p.cliente_nome)}</b><small>${esc(p.endereco)}</small></div></label>`).join('')||'<div class="empty">Não há pedidos pendentes nesta loja.</div>';$('selectedCount').textContent=`${state.selected.size} pedido(s) selecionado(s)`;$('deleteSelectedOrders').disabled=state.selected.size===0;updateOptimizationUI();$('routesList').innerHTML=state.rotas.map(r=>{const d=state.motoboys.find(m=>m.id===r.motoboy_id);return `<div class="route-item"><div><b>Rota #${r.id.slice(0,8)}</b><small>🏍️ ${esc(d?.nome||'Sem motoboy')} · ${state.paradas.filter(p=>p.rota_id===r.id).length} pedidos · ${fmt(r.criada_em)}</small></div>${badge(r.status)}<div class="route-manage"><button type="button" class="secondary" data-route-detail="${esc(r.id)}">${['enviada','em_andamento'].includes(r.status)?'Ver rota':'Detalhes'}</button></div></div>`}).join('')||'<div class="empty">Nenhuma rota enviada.</div>';
$('driverActions').classList.toggle('hidden',state.papel!=='proprietario');
$('driversList').innerHTML=state.motoboys.map(m=>{const loc=driverLoc(m),live=driverLive(loc),routes=activeDriverRoutes(m);return `<div class="panel driver-card"><div class="driver-card-head"><span class="driver-moto" aria-hidden="true">🏍️</span><div><h2>${esc(m.nome)}</h2><span class="driver-presence ${live?'is-online':'is-offline'}"><span class="presence-dot"></span>${driverStatus(loc)}</span></div></div><p class="muted">${validLoc(loc)?`Último GPS: há ${gpsAgeLabel(loc)} · ${fmt(loc.atualizado_em)}`:'Ainda não enviou localização'}</p><p>${routes.length} rota(s) aberta(s) · Usuário: <strong>${esc(m.nome_usuario||'Não definido')}</strong></p><div class="driver-buttons"><button type="button" class="primary" data-driver-focus="${esc(m.id)}" ${validLoc(loc)?'':'disabled'}>📍 Ver no mapa</button>${['proprietario','gerente'].includes(state.papel)?`<button type="button" class="secondary" data-driver-reset-authorize="${esc(m.id)}">Redefinir senha</button>`:''}${state.papel==='proprietario'?`<button type="button" class="secondary" data-driver-toggle="${esc(m.id)}">${m.ativo?'Desativar':'Reativar'}</button><button type="button" class="secondary" data-driver-delete="${esc(m.id)}">Excluir definitivamente</button>`:''}</div></div>`}).join('')||'<div class="empty">Nenhum motoboy cadastrado.</div>' ;renderCentral();renderMap()}
function renderCentral(){
 const host=$('centralRoutes');if(!host)return;
 const active=state.rotas.filter(r=>['enviada','em_andamento'].includes(r.status));
 const cards=active.map(r=>{
  const driver=state.motoboys.find(m=>m.id===r.motoboy_id);
  const loc=driver?driverLoc(driver):null,live=driverLive(loc);
  const stops=state.paradas.filter(st=>st.rota_id===r.id).sort((a,b)=>Number(a.ordem)-Number(b.ordem));
  const rows=stops.map(st=>({st,p:state.pedidos.find(p=>p.id===st.pedido_id)})).filter(x=>x.p);
  const done=rows.filter(x=>x.p.status==='entregue').length;
  const pending=rows.filter(x=>x.p.status==='em_rota');
  const removed=rows.filter(x=>['pendente','cancelado'].includes(x.p.status)).length;
  const total=done+pending.length;
  const next=pending[0];const progress=total?Math.round(100*done/total):0;
  return {driver,loc,live,r,done,pending,removed,total,next,progress};
 });
 const road=cards.reduce((n,c)=>n+c.pending.length,0),done=cards.reduce((n,c)=>n+c.done,0);
 $('centralRoad').textContent=road;$('centralDone').textContent=done;$('centralRemaining').textContent=road;
 host.innerHTML=cards.map(c=>`<article class="panel central-card"><div class="central-card-head"><div class="central-driver"><span class="central-bike">🏍️</span><div><h2>${esc(c.driver?.nome||'Motoboy não encontrado')}</h2><small>Rota #${esc(c.r.id.slice(0,8))} · ${c.total} entrega(s) válida(s)</small></div></div><span class="driver-presence ${c.live?'is-online':'is-offline'}"><span class="presence-dot"></span>${esc(c.driver?driverStatus(c.loc):'Sem motoboy')}</span></div><div class="central-metrics"><span><b>${c.total}</b> Enviadas</span><span><b>${c.done}</b> Concluídas</span><span><b>${c.pending.length}</b> Restantes</span></div><div class="central-progress-head"><strong>Progresso da rota</strong><span>${c.done} de ${c.total} · ${c.progress}%</span></div><div class="central-track"><div style="width:${c.progress}%"></div></div><p class="central-next">${c.next?`📍 Próxima: entrega ${Number(c.next.st.ordem)} — #${esc(c.next.p.numero||'—')} · ${esc(c.next.p.cliente_nome||'Cliente')}`:'Nenhuma entrega pendente nesta rota.'}</p><p class="muted">${c.loc&&validLoc(c.loc)?`GPS: há ${gpsAgeLabel(c.loc)} · ${esc(driverStatus(c.loc))}`:'GPS indisponível'}${c.removed?` · ${c.removed} pedido(s) retirado(s)/cancelado(s)`:''}</p><button type="button" class="primary" data-central-map="${esc(c.r.motoboy_id)}" ${c.loc&&validLoc(c.loc)?'':'disabled'}>📍 Visualizar motoboy no mapa</button></article>`).join('')||'<div class="panel"><div class="empty">Nenhuma rota ativa no momento. Assim que a loja enviar uma rota, ela aparecerá aqui.</div></div>';
}
function renderMap(){
 if(state.page!=='mapa')return;
 if(typeof window.L==='undefined'){
  $('map').innerHTML='<div class="map-notice">Não foi possível carregar o mapa. Verifique a internet ou o bloqueio da biblioteca Leaflet.</div>';
  $('mapDrivers').innerHTML='<div class="empty">Biblioteca do mapa indisponível.</div>';return;
 }
 if(!state.map){
  state.map=L.map('map').setView([-19.9167,-43.9345],12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(state.map);
  state.map.on('dragstart',()=>{state.autoFit=false});state.map.on('zoomstart',()=>{if(!state.programmaticFit)state.autoFit=false});
 }
 state.markers.forEach(x=>x.remove());state.markers=[];
 state.routeLines.forEach(x=>x.remove());state.routeLines=[];
 const focus=state.focusDriver;
 const selected=focus?state.motoboys.filter(m=>m.id===focus):state.motoboys;
 const bounds=[];
 $('mapFocusBanner').classList.toggle('hidden',!focus);
 if(focus){const m=state.motoboys.find(m=>m.id===focus);$('mapFocusName').textContent=m?`Acompanhando: ${m.nome}`:'Motoboy não encontrado'}
 $('mapDrivers').innerHTML=selected.map(m=>{
  const loc=driverLoc(m),valid=validLoc(loc),live=driverLive(loc),routes=activeDriverRoutes(m);
  const label=driverStatus(loc);
  if(valid){
   const marker=L.marker([Number(loc.latitude),Number(loc.longitude)],{icon:bikeIcon(live)}).addTo(state.map)
    .bindPopup(`<b>🏍️ ${esc(m.nome)}</b><br>${esc(label)}<br>Último GPS: há ${gpsAgeLabel(loc)} · ${fmt(loc.atualizado_em)}<br>${routes.length} rota(s) aberta(s)`);
   state.markers.push(marker);bounds.push([Number(loc.latitude),Number(loc.longitude)]);
  }
  let routeHtml='';
  for(const r of routes){
   const stops=state.paradas.filter(p=>p.rota_id===r.id).sort((a,b)=>Number(a.ordem)-Number(b.ordem));
   const points=stops.map(st=>({stop:st,p:state.pedidos.find(p=>p.id===st.pedido_id)})).filter(x=>x.p&&x.p.latitude!=null&&x.p.longitude!=null&&Number.isFinite(Number(x.p.latitude))&&Number.isFinite(Number(x.p.longitude))&&Math.abs(Number(x.p.latitude))<=90&&Math.abs(Number(x.p.longitude))<=180).map(x=>({coords:[Number(x.p.latitude),Number(x.p.longitude)],ordem:Number(x.stop.ordem),pedido:x.p}));
   if(points.length){
    const coords=valid?[[Number(loc.latitude),Number(loc.longitude)],...points.map(p=>p.coords)]:points.map(p=>p.coords);
    // Exibe apenas geometria viaria; nunca desenha reta atravessando quadras.
    const key=r.id+':'+coords.map(p=>p.join(',')).join(';');
    if(state.roadCache.has(key)){
      const line=L.polyline(state.roadCache.get(key),{color:'#1685e8',weight:5,opacity:.9}).addTo(state.map);state.routeLines.push(line);
    }else if(!state.roadPending.has(key)){
      state.roadPending.add(key);
      drawRoadLine(r.id,coords,state.map).then(()=>{if(state.page==='mapa')renderMap()}).catch(()=>{if(state.page==='mapa')toast('Sem trajeto pelas ruas para uma rota. Verifique a conexao.',true)}).finally(()=>state.roadPending.delete(key));
    }bounds.push(...points.map(p=>p.coords));
    points.forEach(pt=>{const marker=L.marker(pt.coords,{icon:L.divIcon({className:"route-number-icon",html:`<span>${pt.ordem}</span>`,iconSize:[30,30],iconAnchor:[15,15]})}).addTo(state.map).bindPopup(`<b>Ponto ${pt.ordem}</b><br>Pedido #${esc(pt.pedido.numero||"—")}<br>${esc(pt.pedido.cliente_nome||"")}<br>${esc(pt.pedido.endereco||"")}`);state.routeLines.push(marker)});
    routeHtml+=`<small>Rota #${esc(r.id.slice(0,8))}: ${points.length} parada(s) no mapa · trajeto pelas ruas (OSRM)</small>`;
   }else routeHtml+=`<small>Rota #${esc(r.id.slice(0,8))}: sem coordenadas das paradas</small>`;
  }
  return `<div class="map-driver"><strong>🏍️ ${esc(m.nome)}</strong><span class="driver-presence ${live?'is-online':'is-offline'}"><span class="presence-dot"></span>${esc(label)}</span><small>${valid?'Último GPS: há '+gpsAgeLabel(loc)+' · '+fmt(loc.atualizado_em):'Sem localização registrada'}</small>${routeHtml}</div>`;
 }).join('')||'<div class="empty">Nenhum motoboy para mostrar.</div>';
 if(bounds.length&&state.autoFit){state.programmaticFit=true;state.map.fitBounds(bounds,{maxZoom:focus?16:15,padding:[40,40]});state.programmaticFit=false}
 setTimeout(()=>state.map?.invalidateSize(),100);
}

function page(name){if(name==='mapa'&&state.page!=='mapa')state.autoFit=true;state.page=name;document.querySelectorAll('.page').forEach(e=>e.classList.toggle('hidden',e.id!==`page-${name}`));document.querySelectorAll('.nav[data-page]').forEach(e=>e.classList.toggle('active',e.dataset.page===name));const titles={inicio:['Visão geral','Acompanhe as entregas da sua loja'],pedidos:['Pedidos','Cadastre e organize entregas'],rotas:['Rotas','Envie pedidos para o motoboy'],motoboys:['Motoboys','Equipe de entregadores'],central:['Central de Entregas','Acompanhe o progresso e a localização dos motoboys'],financeiro:['Financeiro','Extrato e remuneração por motoboy'],mapa:['Mapa em tempo real','Acompanhe a posição dos entregadores'],atualizacoes:['Atualizações','Distribua novas versões dos aplicativos']};$('pageTitle').textContent=titles[name][0];$('pageSubtitle').textContent=titles[name][1];render();if(name==='financeiro')loadFinance();if(name==='atualizacoes')loadUpdates();if(name==='motoboys')loadAccessRequests()}
async function saveOutside(ev){
 ev.preventDefault();const desc=$('outsideDescription').value.trim(),address=$('outsideAddress').value.trim();
 if(!desc||!address)return toast('Informe o serviço e o endereço.',true);
 const payload={empresa_id:state.empresa.id,loja_id:$('outsideStore').value,
  numero:'AV-'+Date.now().toString(36).toUpperCase(),plataforma:'outro',cliente_nome:'Tiago — serviço por fora',
  endereco:address,referencia:'[CORRIDA POR FORA] '+desc,complemento:desc,
  latitude:$('outsideLat').value.trim()?Number($('outsideLat').value):null,longitude:$('outsideLng').value.trim()?Number($('outsideLng').value):null};
 const {data,error}=await sb.from('pedidos').insert(payload).select('id').single();
 if(error)return toast('Não foi possível criar corrida: '+errorText(error),true);
 $('outsideDialog').close();$('outsideDescription').value='';await fetchAll();
 $('routeStore').dataset.selected=payload.loja_id;state.selected=new Set([data.id]);page('rotas');
 toast('Corrida por fora criada e selecionada. Escolha o motoboy e envie a rota.');
}
async function saveOrder(ev){ev.preventDefault();const payload={empresa_id:state.empresa.id,loja_id:$('orderStore').value,numero:$('orderNumber').value.trim()||null,plataforma:$('orderPlatform').value,cliente_nome:$('orderClient').value.trim(),endereco:$('orderAddress').value.trim(),complemento:$('orderComplement').value.trim()||null,referencia:$('orderReference').value.trim()||null,localizador:$('orderLocator').value.trim()||null,latitude:$('orderLat').value?Number($('orderLat').value):null,longitude:$('orderLng').value?Number($('orderLng').value):null};const {error}=await sb.from('pedidos').insert(payload);if(error)return toast(errorText(error),true);$('orderDialog').close();$('orderForm').reset();toast('Pedido cadastrado com sucesso!');await fetchAll()}
// Mesma estrategia do Android: matriz OSRM de duracao viaria e vizinho mais proximo.
function invalidateOptimization(){state.optimized=null;updateOptimizationUI()}
function optimizeFeedback(message,bad=false){const el=$('optimizeFeedback');if(el){el.textContent=message;el.style.color=bad?'#ff9b9b':'#9be7bd';el.style.display='block'}if(bad)toast(message,true)}
function updateOptimizationUI(){
 const el=$('optimizedPreview');if(!el)return;
 const o=state.optimized;
 el.textContent=o?`Ordem ${o.manual?'de seleção (sem coordenadas)':'otimizada'}: ${o.ids.map((id,i)=>{const p=state.pedidos.find(x=>x.id===id);return `${i+1}. #${p?.numero||'?'} ${p?.cliente_nome||''}`}).join(' → ')}${o.minutes!=null?` · estimativa ${Math.round(o.minutes)} min`:''}`:'Selecione o motoboy e os pedidos, depois clique em Otimizar rota.';
 $('sendRoute').disabled=!o;
}
async function optimizeSelected(){
 optimizeFeedback('Verificando GPS, motoboy e pedidos...');
 const driver=$('routeDriver').value,store=$('routeStore').value,ids=[...state.selected];
 if(!driver||!ids.length)return optimizeFeedback('Selecione um motoboy online e pelo menos um pedido. Se a lista estiver vazia, confira GPS ativo e se existe rota aberta.',true);
 const m=state.motoboys.find(x=>x.id===driver),loc=m&&driverLoc(m);
 if(!m||!driverLive(loc)||activeDriverRoutes(m).length)return optimizeFeedback('Motoboy offline, com GPS desatualizado ou com outra rota aberta. Retire/encerre a rota anterior para liberar.',true);
 if(!validLoc(loc))return optimizeFeedback('Sem coordenadas de GPS do motoboy. Ative o rastreamento no Android.',true);
 const orders=ids.map(id=>state.pedidos.find(p=>p.id===id));
 if(orders.some(p=>!p||p.loja_id!==store||p.status!=='pendente'))return optimizeFeedback('Há pedidos que não estão mais pendentes nesta loja. Atualize a seleção.',true);
 // Latitude/longitude dos pedidos são opcionais; se faltar, manter ordem de seleção.
 const hasCoords=p=>p.latitude!=null&&p.longitude!=null&&Number.isFinite(Number(p.latitude))&&Number.isFinite(Number(p.longitude))&&Math.abs(Number(p.latitude))<=90&&Math.abs(Number(p.longitude))<=180;
 if(orders.some(p=>!hasCoords(p))){
  state.optimized={ids:[...ids],driver,store,origin:null,minutes:null,manual:true};
  updateOptimizationUI();
  optimizeFeedback('Pedidos sem coordenadas: ordem de seleção mantida. Confira os endereços e envie a rota.');
  return;
 }
 const coords=[[Number(loc.longitude),Number(loc.latitude)],...orders.map(p=>[Number(p.longitude),Number(p.latitude)])];
 const button=$('optimizeRoute');button.disabled=true;button.textContent='Calculando pelas ruas...';optimizeFeedback('Consultando as ruas para calcular a melhor sequência...');
 try{
  const q=coords.map(c=>c.join(',')).join(';');
  const res=await fetch(`https://router.project-osrm.org/table/v1/driving/${q}?annotations=duration`);
  if(!res.ok)throw Error('Servico de roteamento indisponivel');
  const json=await res.json();if(json.code!=='Ok'||!json.durations)throw Error(json.message||'Matriz viaria indisponivel');
  const left=orders.map((_,i)=>i),ordered=[];let from=0,total=0;
  while(left.length){let best=null,bestDuration=Infinity;for(const i of left){const d=json.durations[from]?.[i+1];if(typeof d==='number'&&d<bestDuration){best=i;bestDuration=d}}if(best===null)throw Error('Nao existe trajeto pelas ruas para todos os pontos');ordered.push(ids[best]);left.splice(left.indexOf(best),1);from=best+1;total+=bestDuration}
  state.optimized={ids:ordered,driver,store,origin:coords[0],minutes:total/60};updateOptimizationUI();optimizeFeedback('Rota otimizada! Confira a ordem abaixo e clique em Enviar rota ao motoboy.');toast('Rota otimizada a partir do GPS do motoboy.');
 }catch(e){invalidateOptimization();optimizeFeedback('Não foi possível otimizar: '+errorText(e),true)}finally{button.disabled=false;button.textContent='🧭 Otimizar rota'}
}
async function drawRoadLine(routeId,coords,map){
 const key=routeId+':'+coords.map(p=>p.join(',')).join(';');
 if(state.roadCache.has(key))return state.roadCache.get(key);
 const url='https://router.project-osrm.org/route/v1/driving/'+coords.map(p=>`${p[1]},${p[0]}`).join(';')+'?overview=full&geometries=geojson&steps=false';
 const response=await fetch(url);if(!response.ok)throw Error('Roteamento indisponivel');
 const data=await response.json();if(data.code!=='Ok'||!data.routes?.[0]?.geometry?.coordinates)throw Error('Sem caminho viario');
 const road=data.routes[0].geometry.coordinates.map(p=>[p[1],p[0]]);state.roadCache.set(key,road);return road;
}
async function deleteSelectedOrders(){
 const ids=[...state.selected];if(!ids.length)return;
 const store=$('routeStore').value;
 const valid=ids.every(id=>state.pedidos.some(p=>p.id===id&&p.empresa_id===state.empresa.id&&p.loja_id===store&&p.status==='pendente'));
 if(!valid){toast('A seleção mudou. Atualize os pedidos.',true);await fetchAll();return;}
 const names=ids.map(id=>{const p=state.pedidos.find(x=>x.id===id);return '#'+(p.numero||p.id.slice(0,6))+' — '+p.cliente_nome;});
 if(!confirm(`Cancelar ${ids.length} pedido(s)?\n\n${names.slice(0,8).join('\n')}\n\nOs pedidos sairão dos disponíveis, mas permanecerão no histórico. Não haverá pagamento automático.`))return;
 const btn=$('deleteSelectedOrders');btn.disabled=true;btn.textContent='Cancelando...';
 try{
  const {data,error}=await sb.rpc('rota_cancelar_pedidos_loja',{p_empresa_id:state.empresa.id,p_loja_id:store,p_pedido_ids:ids});
  if(error)throw error;
  if(Number(data?.cancelados)!==ids.length)throw new Error('Quantidade diferente da seleção. Atualize e confira.');
  state.selected.clear();invalidateOptimization();toast(`${ids.length} pedido(s) cancelado(s). Histórico preservado.`);await fetchAll();
 }catch(e){toast('Não foi possível cancelar: '+errorText(e),true);await fetchAll()}
 finally{btn.textContent='🚫 Cancelar selecionados';btn.disabled=state.selected.size===0;}
}

async function sendRoute(){const driver=$('routeDriver').value,store=$('routeStore').value;const opt=state.optimized;const ids=opt?.ids||[];if(!opt||opt.driver!==driver||opt.store!==store||ids.length!==state.selected.size||ids.some(id=>!state.selected.has(id)))return toast('Otimize a rota antes de enviar. A ordem deve ser conferida.',true);if(!driver||!store||!ids.length)return toast('Selecione a loja, o motoboy e pelo menos um pedido.',true);const availableDriver=state.motoboys.find(m=>m.id===driver);if(!availableDriver||!availableDriver.ativo||!driverLive(driverLoc(availableDriver)) ) return toast('Motoboy offline ou inativo. Atualize e escolha outro.',true);const button=$('sendRoute');button.disabled=true;let created=null;try{const check=await Promise.all([sb.from('localizacoes_motoboy').select('*').eq('empresa_id',state.empresa.id).eq('motoboy_id',driver).maybeSingle()]);if(check.some(x=>x.error))throw (check.find(x=>x.error).error);if(!driverLive(check[0].data))throw new Error('Motoboy ficou offline.');const {data,error}=await sb.from('rotas').insert({empresa_id:state.empresa.id,loja_id:store,motoboy_id:driver,status:'enviada',enviada_em:new Date().toISOString()}).select('id').single();if(error)throw error;created=data.id;const stops=ids.map((id,i)=>({empresa_id:state.empresa.id,rota_id:created,pedido_id:id,ordem:i+1}));const inserted=await sb.from('rota_paradas').insert(stops);if(inserted.error)throw inserted.error;const updated=await sb.from('pedidos').update({status:'em_rota',atualizado_em:new Date().toISOString()}).in('id',ids).eq('empresa_id',state.empresa.id).eq('status','pendente').select('id');if(updated.error)throw updated.error;if(updated.data.length!==ids.length)throw new Error('Nem todos os pedidos puderam ser atualizados. Verifique a rota antes de reenviar.');state.selected.clear();invalidateOptimization();toast('Rota registrada no Supabase! Confira o recebimento no aplicativo do motoboy.');await fetchAll()}catch(e){toast(`Erro ao enviar rota: ${errorText(e)}${created?' (rota criada parcialmente; confira antes de tentar novamente)':''}`,true);await fetchAll()}finally{button.disabled=false}}


// Importação por texto: revisão obrigatória antes de salvar no Supabase.
let waDraft=[];
function waValue(text, labels){
 for(const label of labels){
  const safe=label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const re=new RegExp('(?:^|\\n)\\s*\\*?'+safe+'\\*?\\s*[:\\-]\\s*\\*?([^\\n]+)','im');
  const m=text.match(re);if(m)return m[1].trim().replace(/^\*|\*$/g,'').trim();
 }
 return '';
}
function waCoordinates(block){
 // Primeiro link de coordenadas do Google Maps ou Waze, sem usar endereço textual.
 const m=block.match(/(?:destination=|[?&]ll=)(-?\d{1,2}(?:\.\d+)?)(?:%2C|,)(-?\d{1,3}(?:\.\d+)?)/i);
 if(!m)return [null,null];
 const lat=Number(m[1]),lng=Number(m[2]);
 return Math.abs(lat)<=90&&Math.abs(lng)<=180?[lat,lng]:[null,null];
}
// Leitor adaptado das regras do parseMessages/parseBatchBlock do Android.
// Nao depende de a mensagem conter links em cada pedido.
function parseWa(text){
 const raw=String(text||'').replace(/\r/g,'').trim();
 if(!raw)return [];
 const headers=[...raw.matchAll(/^\s*\*?(\d+)º\s+Pedido\s*\(#?([^\)]+)\)\*?\s*$/gim)];
 const coordBySeq=new Map();
 for(const m of raw.matchAll(/^\s*(\d+)º\s*:\s*https?:\/\/(?:www\.)?waze\.com\/ul\?[^\n]*?ll=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/gim)){
  coordBySeq.set(Number(m[1]),[Number(m[2]),Number(m[3])]);
 }
 const blocks=[];
 if(headers.length){
  const footer=raw.search(/(?:^|\n)\s*\*?Localizadores\*?\s*(?:\n|$)/im);
  headers.forEach((h,i)=>{
   const end=i+1<headers.length?headers[i+1].index:(footer>=0?footer:raw.length);
   blocks.push({seq:Number(h[1]),numero:h[2].trim(),text:raw.slice(h.index,end)});
  });
 }else{
  const starts=[...raw.matchAll(/^\s*\*?Pedido\s*:\s*\*?#?[^\n*]+\*?/gim)];
  if(starts.length){starts.forEach((m,i)=>blocks.push({seq:i+1,numero:'',text:raw.slice(m.index,i+1<starts.length?starts[i+1].index:raw.length)}));}
  else blocks.push({seq:1,numero:'',text:raw});
 }
 return blocks.map(entry=>{
  const block=entry.text;
  const get=(...labels)=>waValue(block,labels);
  const numero=entry.numero||get('Pedido').replace(/^#/,'').replace(/\*/g,'').trim();
  const cliente=get('Nome');
  const rua=get('Rua');const numeroCasa=get('Número','Numero');const bairro=get('Bairro');
  const endereco=[rua,numeroCasa,bairro].filter(Boolean).join(', ');
  const coords=coordBySeq.get(entry.seq)||waCoordinates(block);
  const lat=coords[0],lon=coords[1];
  const is99=/food-b-h5\.99app\.com|99app\.com/i.test(block);
  return {numero,cliente_nome:cliente,endereco,complemento:get('Complemento'),referencia:get('Ponto de referência','Referência'),localizador:get('Localizador'),plataforma:is99?'99food':'ifood',latitude:lat,longitude:lon,...waPayment(block),indice:entry.seq};
 }).filter(p=>p.numero||p.localizador||p.endereco);
}
function waPayment(block){
 const clean=block.replace(/\*/g,'').replace(/`/g,'');
 const method=(clean.match(/^\s*Forma de pagamento\s*:\s*(.+)$/im)||[])[1]?.trim()||'';
 const option=(clean.match(/^\s*Opção de pagamento\s*:\s*(.+)$/im)||[])[1]?.trim()||'';
 const paid=/pagamento online j[aá] realizado|pagamento j[aá] realizado|j[aá] pago|pago online/i.test(clean);
 const charge=/pagamento na entrega|pagar na entrega|cobrar na entrega|receber na entrega|pagamento pendente|a cobrar/i.test(clean) || (!paid && /\b(dinheiro|maquininha|cart[aã]o na entrega|pix na entrega)\b/i.test(method));
 const amounts=[...clean.matchAll(/^\s*(?:R\$\s*)?([\d.]+,\d{2})\s*Total\s*$/gim)];
 const total=amounts.length?Number(amounts[amounts.length-1][1].replace(/\./g,'').replace(',','.')):null;
 return {pagamento_status:paid?'pago':charge?'cobrar':'nao_informado',pagamento_forma:[method,option].filter(Boolean).join(' • '),pagamento_valor:total};
}
function previewWa(){
 try{
  waDraft=parseWa($('waText').value);
  $('waPreview').innerHTML=waDraft.map((x,i)=>`<div class="wa-item"><b>Ponto ${x.indice} — Pedido #${esc(x.numero)}</b><label>Cliente<input data-wa="${i}:cliente_nome" value="${esc(x.cliente_nome)}"></label><label>Endereço<input data-wa="${i}:endereco" value="${esc(x.endereco)}"></label><label>Complemento<input data-wa="${i}:complemento" value="${esc(x.complemento)}"></label><label>Referência<input data-wa="${i}:referencia" value="${esc(x.referencia)}"></label><label>Localizador<input data-wa="${i}:localizador" value="${esc(x.localizador)}"></label><div class="two"><label>Latitude<input data-wa="${i}:latitude" value="${esc(x.latitude??'')}"></label><label>Longitude<input data-wa="${i}:longitude" value="${esc(x.longitude??'')}"></label></div><label>Pagamento<select data-wa="${i}:pagamento_status"><option value="pago" ${x.pagamento_status==='pago'?'selected':''}>Pago online</option><option value="cobrar" ${x.pagamento_status==='cobrar'?'selected':''}>Cobrar na entrega</option><option value="nao_informado" ${x.pagamento_status==='nao_informado'?'selected':''}>Não informado</option></select></label><label>Forma de pagamento<input data-wa="${i}:pagamento_forma" value="${esc(x.pagamento_forma)}"></label><label>Total do pedido (R$)<input type="number" min="0" step="0.01" data-wa="${i}:pagamento_valor" value="${esc(x.pagamento_valor??'')}"></label><small>O total do pedido não é o valor recebido pelo motoboy.</small><small>${x.latitude!=null&&x.longitude!=null?'📍 Coordenadas presentes':'Sem coordenadas: cadastro e despacho permitidos; sem marcador no mapa'}</small></div>`).join('')||'<p class="muted">Nenhum pedido reconhecido. Confira se a mensagem contém Pedido: #1 ou 1º Pedido (#27).</p>';
  $('waSaveBtn').disabled=!waDraft.length;
  toast(waDraft.length?`${waDraft.length} pedido(s) reconhecido(s). Confira e salve.`:'Nenhum pedido reconhecido.',!waDraft.length);
 }catch(e){waDraft=[];$('waSaveBtn').disabled=true;$('waPreview').textContent='Erro ao ler mensagem: '+errorText(e);toast(errorText(e),true);}
}
$('waPreviewBtn').onclick=previewWa;
$('waPreview').addEventListener('change',e=>{const key=e.target.dataset.wa;if(!key)return;const [index,field]=key.split(':');waDraft[Number(index)][field]=e.target.value});
$('waPreview').addEventListener('input',e=>{const key=e.target.dataset.wa;if(!key)return;const [index,field]=key.split(':');waDraft[Number(index)][field]=e.target.value});
$('waSaveBtn').onclick=async()=>{
 const store=$('waStore').value;if(!store)return toast('Escolha a loja primeiro.',true);
 if(!waDraft.length)return toast('Confira uma mensagem primeiro.',true);
 const rows=[];
 for(const x of waDraft){if(!x.cliente_nome.trim()||!x.endereco.trim())return toast('Preencha cliente e endereço de todos os pedidos.',true);
 const lat=x.latitude===''?null:Number(String(x.latitude).replace(',','.')),lng=x.longitude===''?null:Number(String(x.longitude).replace(',','.'));
 if((lat!==null&&!Number.isFinite(lat))||(lng!==null&&!Number.isFinite(lng)))return toast('Latitude ou longitude inválida.',true);
 rows.push({empresa_id:state.empresa.id,loja_id:store,numero:x.numero.trim()||null,plataforma:x.plataforma,cliente_nome:x.cliente_nome.trim(),endereco:x.endereco.trim(),complemento:x.complemento.trim()||null,referencia:x.referencia.trim()||null,localizador:x.localizador.trim()||null,latitude:lat,longitude:lng,status:'pendente',pagamento_status:x.pagamento_status,pagamento_forma:x.pagamento_forma||null,pagamento_valor:x.pagamento_valor===''?null:x.pagamento_valor});
 }
 const btn=$('waSaveBtn');btn.disabled=true;
 try{const {data,error}=await sb.from('pedidos').insert(rows).select('id');if(error)throw error;waDraft=[];$('waText').value='';$('waPreview').innerHTML='';await fetchAll();if(data?.length===rows.length){$('routeStore').dataset.selected=store;state.selected=new Set(data.map(p=>p.id));page('rotas');toast(`${rows.length} pedido(s) criados no Supabase e selecionados para despacho. Escolha o motoboy e confira a ordem.`)}else toast(`${rows.length} pedido(s) cadastrados. Abra Rotas e selecione-os para despachar.`)}
 catch(e){toast('Erro ao importar: '+errorText(e),true)}finally{btn.disabled=!waDraft.length}
};
// A geração ocorre exclusivamente em função SQL autorizada, nunca no navegador.
function showDriverCode(code){$('driverCode').textContent=code;$('driverCodeResult').classList.remove('hidden')}
$('driverForm').addEventListener('submit',async ev=>{
 ev.preventDefault();
 const nome=$('driverName').value.trim();
 const usuario=$('driverUsername').value.trim().toLowerCase();
 let senha=$('driverPassword').value;
 if(nome.length<2||! /^[a-z0-9._-]{3,80}$/.test(usuario)||senha.length<8||senha.length>72)return toast('Informe nome, usuário válido e senha de 8 a 72 caracteres.',true);
 const btn=$('driverForm').querySelector('button');btn.disabled=true;
 try{
  const {data,error}=await sb.rpc('rota_cadastrar_motoboy_login',{p_empresa:state.empresa.id,p_nome:nome,p_usuario:usuario,p_senha:senha});
  if(error)throw error;
  if(!data?.ok)throw Error(data?.mensagem||'Cadastro não confirmado.');
  $('driverForm').reset();toast('Motoboy cadastrado com usuário e senha. O primeiro celular precisará de aprovação.');await fetchAll();
 }catch(e){toast('Cadastro não concluído: '+errorText(e),true)}finally{senha='';btn.disabled=false}
});
$('driversList').addEventListener('click',async ev=>{
 const id=ev.target.closest('[data-driver-code]')?.dataset.driverCode;if(!id)return;
 const motoboy=state.motoboys.find(m=>m.id===id);if(!motoboy||!confirm(`Gerar novo código para ${motoboy.nome}? O código anterior será invalidado.`))return;
 const btn=ev.target.closest('button');btn.disabled=true;
 try{const {data,error}=await sb.rpc('rota_gerar_codigo_motoboy',{p_empresa:state.empresa.id,p_motoboy:id});if(error)throw error;showDriverCode(data.codigo);toast('Novo código gerado.');}
 catch(e){toast('Não foi possível gerar o código: '+errorText(e),true)}finally{btn.disabled=false}
});
// Recuperação administrativa: revoga o aparelho antigo e emite código único para criar nova senha.
// A senha antiga nunca é exibida. A operação é atômica no Supabase.
$('driversList').addEventListener('click',async ev=>{
 const btn=ev.target.closest('[data-driver-recover],[data-driver-release]');if(!btn)return;
 const id=btn.dataset.driverRecover||btn.dataset.driverRelease;
 const m=state.motoboys.find(x=>x.id===id);
 if(!m||state.papel!=='proprietario')return toast('Apenas o proprietário pode recuperar acessos.',true);
 const recovery=!!btn.dataset.driverRecover;
 const question=recovery?'Redefinir senha':'Liberar novo aparelho';
 if(!confirm(`${question} de ${m.nome}?\n\nO aparelho atual será revogado. Um novo código temporário será gerado para o motoboy criar outra senha no aplicativo. O código anterior será invalidado.`))return;
 btn.disabled=true;
 try{
  const {data,error}=await sb.rpc('rota_recuperar_acesso_motoboy',{p_empresa:state.empresa.id,p_motoboy:id});
  if(error)throw error;
  if(!data?.codigo)throw new Error('O servidor não retornou o código de recuperação.');
  showDriverCode(data.codigo);
  $('driverCodeResult').scrollIntoView({behavior:'smooth',block:'center'});
  toast('Acesso anterior revogado. Entregue o novo código ao motoboy com segurança.');
 }catch(e){toast('Recuperação não concluída: '+errorText(e),true)}finally{btn.disabled=false}
});

// Administração de acessos: somente RPCs com validação de gestor no servidor.
async function loadAccessRequests(){
 const host=$('accessRequests');if(!host||!state.empresa)return;
 if(!['proprietario','gerente'].includes(state.papel)){host.textContent='Apenas proprietário ou gerente pode analisar solicitações.';return}
 const {data,error}=await sb.rpc('rota_listar_solicitacoes_acesso',{p_empresa:state.empresa.id});
 if(error){host.textContent='Não foi possível consultar solicitações: '+errorText(error);return}
 accessRequests=data||[];
 host.innerHTML=accessRequests.length?accessRequests.map(r=>`<div class="panel"><strong>${esc(r.nome)}</strong> · @${esc(r.nome_usuario)}<p class="muted">Solicitado em ${fmt(r.solicitado_em)}</p><button type="button" class="primary" data-access-approve="${esc(r.solicitacao_id)}">Aprovar solicitação</button> <button type="button" class="secondary" data-access-reject="${esc(r.solicitacao_id)}">Rejeitar</button></div>`).join(''):'<p class="muted">Nenhuma solicitação pendente.</p>';
}
$('accessRefresh').addEventListener('click',loadAccessRequests);
$('accessRequests').addEventListener('click',async e=>{
 const btn=e.target.closest('[data-access-approve],[data-access-reject]');if(!btn)return;
 const approve=!!btn.dataset.accessApprove,id=btn.dataset.accessApprove||btn.dataset.accessReject;
 const r=accessRequests.find(x=>x.solicitacao_id===id);if(!r)return;
 if(!confirm(`${approve?'Aprovar':'Rejeitar'} a solicitação de ${r.nome}?\n\nA aprovação registra a decisão no banco. O Android de teste deverá consultar e consumir a aprovação antes do prazo de 15 minutos.`))return;
 btn.disabled=true;
 try{const {data,error}=await sb.rpc('rota_decidir_solicitacao_acesso',{p_solicitacao:id,p_aprovar:approve});if(error)throw error;if(!data?.ok)throw Error('Servidor não confirmou a decisão.');toast(approve?'Solicitação aprovada. Aguardando ativação pelo aparelho de teste.':'Solicitação rejeitada.');await loadAccessRequests()}
 catch(err){toast('Não foi possível analisar: '+errorText(err),true)}finally{btn.disabled=false}
});
// Redefinicao gerenciada: autorizacao e conclusao na mesma operacao do painel.
// Nunca registra a senha em logs, URLs, HTML ou armazenamento local.
$('driversList').addEventListener('click',async e=>{
 const btn=e.target.closest('[data-driver-reset-authorize]');if(!btn)return;
 const m=state.motoboys.find(x=>x.id===btn.dataset.driverResetAuthorize);if(!m)return;
 if(!['proprietario','gerente'].includes(state.papel))return toast('Apenas proprietário ou gerente pode definir a senha.',true);
 if(!confirm(`Definir NOVA senha de acesso de ${m.nome} (@${m.nome_usuario||'sem usuário'})?\n\nA senha antiga do aplicativo continuará preservada. Informe a senha pessoalmente ao funcionário por um canal seguro.`))return;
 let senha=prompt(`Nova senha para ${m.nome} (8 a 72 caracteres):`);
 if(senha===null)return;
 try{
  if(senha.length<8||senha.length>72)throw Error('A senha precisa ter entre 8 e 72 caracteres.');
  const confirmacao=prompt('Repita exatamente a nova senha:');
  if(confirmacao===null)return;
  if(senha!==confirmacao)throw Error('As senhas não conferem. Nenhuma alteração realizada.');
  btn.disabled=true;
  const autorizacao=await sb.rpc('rota_autorizar_redefinicao_senha',{p_empresa:state.empresa.id,p_motoboy:m.id});
  if(autorizacao.error)throw autorizacao.error;
  const solicitacao=autorizacao.data?.solicitacao_id;
  if(!autorizacao.data?.ok||!solicitacao)throw Error('Não foi possível autorizar a redefinição.');
  const conclusao=await sb.rpc('rota_concluir_redefinicao_senha',{p_solicitacao:solicitacao,p_nova_senha:senha});
  if(conclusao.error)throw conclusao.error;
  if(!conclusao.data?.ok)throw Error('O servidor não confirmou a nova senha.');
  toast(`Senha nova de ${m.nome} cadastrada. O acesso antigo foi preservado.`);
 }catch(err){toast('Não foi possível definir a senha: '+errorText(err),true)}
 finally{senha='';btn.disabled=false}
});

// Gestão administrativa: as ações são validadas novamente no banco via RPC.
$('driversList').addEventListener('click',async ev=>{
 const btn=ev.target.closest('[data-driver-toggle],[data-driver-delete]');if(!btn)return;
 const id=btn.dataset.driverToggle||btn.dataset.driverDelete;
 const m=state.motoboys.find(x=>x.id===id);
 if(!m||state.papel!=='proprietario')return toast('Apenas o proprietário pode gerenciar contas.',true);
 const permanent=!!btn.dataset.driverDelete;
 const action=permanent?'excluir':(m.ativo?'desativar':'reativar');
 const message=permanent?`EXCLUIR DEFINITIVAMENTE ${m.nome}?\n\nEsta ação não tem volta. O sistema tentará apagar o cadastro e o login vinculado. Se houver rotas, financeiro, outros vínculos ou dados que precisem ser preservados, a exclusão será bloqueada. Nesse caso, use Desativar.`:`${m.ativo?'Desativar':'Reativar'} ${m.nome}?`;
 if(!confirm(message))return;
 if(permanent&&prompt(`Para confirmar, digite EXCLUIR:`)!=='EXCLUIR')return;
 btn.disabled=true;
 try{const {error}=await sb.rpc('rota_gerenciar_conta_motoboy',{p_empresa:state.empresa.id,p_motoboy:id,p_acao:action});if(error)throw error;toast(action==='excluir'?'Cadastro e login excluídos, quando vinculados.':action==='desativar'?'Motoboy desativado.':'Motoboy reativado.');await fetchAll()}
 catch(e){toast('Operação não concluída: '+errorText(e),true)}finally{btn.disabled=false}
});
$('copyDriverCode').onclick=async()=>{try{await navigator.clipboard.writeText($('driverCode').textContent);toast('Código copiado.')}catch(e){toast('Selecione e copie o código manualmente.',true)}};

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').textContent='';const {error}=await sb.auth.signInWithPassword({email:$('email').value,password:$('password').value});if(error){$('loginError').textContent=error.message;return}try{await start()}catch(err){$('loginError').textContent='Erro ao abrir painel: '+errorText(err)}});$('logout').onclick=async()=>{await sb.auth.signOut();state.user=null;state.empresa=null;location.reload()};$('nav').addEventListener('click',e=>{const b=e.target.closest('[data-page]');if(b)page(b.dataset.page)});document.addEventListener('click',e=>{const b=e.target.closest('[data-go]');if(b)page(b.dataset.go)});$('refresh').onclick=fetchAll;$('centralRefresh').onclick=fetchAll;$('centralRoutes').addEventListener('click',e=>{const b=e.target.closest('[data-central-map]');if(b)focusDriver(b.dataset.centralMap)});$('driversList').addEventListener('click',e=>{const b=e.target.closest('[data-driver-focus]');if(b)focusDriver(b.dataset.driverFocus)});$('showAllDrivers').onclick=()=>{state.focusDriver=null;state.autoFit=true;renderMap()};$('newOrder').onclick=$('quickOrder').onclick=()=>$('orderDialog').showModal();$('quickOutside').onclick=()=>$('outsideDialog').showModal();$('outsideClose').onclick=()=>$('outsideDialog').close();$('outsideForm').onsubmit=saveOutside;$('closeDialog').onclick=()=>$('orderDialog').close();$('orderForm').onsubmit=saveOrder;$('orderSearch').oninput=render;$('orderFilter').onchange=render;$('routeStore').onchange=e=>{invalidateOptimization();e.target.dataset.selected=e.target.value;state.selected.clear();render()};$('routeCandidates').onchange=e=>{invalidateOptimization();const id=e.target.dataset.pick;if(!id)return;e.target.checked?state.selected.add(id):state.selected.delete(id);$('selectedCount').textContent=`${state.selected.size} pedido(s) selecionado(s)`;$('deleteSelectedOrders').disabled=state.selected.size===0};$('deleteSelectedOrders').onclick=deleteSelectedOrders;$('sendRoute').onclick=sendRoute;$('optimizeRoute').onclick=optimizeSelected;$('routeDriver').onchange=invalidateOptimization;
// Acoes administrativas atomicas: nunca remover entregas concluidas do historico.
async function manageRoute(id,action){
 const route=state.rotas.find(r=>r.id===id);if(!route)return;
 const stops=state.paradas.filter(p=>p.rota_id===id).sort((a,b)=>a.ordem-b.ordem);
 const orders=stops.map(st=>state.pedidos.find(p=>p.id===st.pedido_id)).filter(Boolean);
 if(action==='detail'||action==='actions'){
  const editable=['enviada','em_andamento'].includes(route.status);
  const items=stops.map((st,i)=>({st,p:state.pedidos.find(p=>p.id===st.pedido_id)})).filter(x=>x.p);
  const body=items.map(({st,p},i)=>`<div class="route-item"><div><b>${i+1}. #${esc(p.numero||'')} — ${esc(p.cliente_nome)}</b><small>${esc(p.endereco)} · ${esc(p.status)}</small></div>${editable&&p.status==='em_rota'?`<div class="route-manage"><button type="button" class="secondary" data-stop-confirm="${esc(st.id)}">Confirmar entrega</button><button type="button" class="secondary" data-stop-release="${esc(st.id)}">Retirar da rota</button><button type="button" class="secondary" data-stop-cancel="${esc(st.id)}">Cancelar e remunerar R$ 10</button></div>`:''}</div>`).join('');
  const old=document.getElementById('routeDetailModal');if(old)old.remove();
  const dlg=document.createElement('dialog');dlg.id='routeDetailModal';dlg.innerHTML=`<div style="padding:20px;min-width:min(520px,90vw);max-height:75vh;overflow:auto"><h3>Rota #${esc(id.slice(0,8))}</h3><p>${esc(route.status)} · ${esc(state.motoboys.find(m=>m.id===route.motoboy_id)?.nome||'—')}</p><p class="muted">${editable?'Selecione uma ação somente no pedido desejado.':'Histórico da rota — somente consulta.'}</p>${body}${editable?`<div class="route-bottom-actions"><button type="button" class="secondary" id="releaseWholeRoute">Retirar rota inteira</button></div>`:''}<p><button type="button" id="closeRouteDetail">Fechar</button></p></div>`;document.body.appendChild(dlg);dlg.showModal();dlg.querySelector('#closeRouteDetail').onclick=()=>dlg.close();dlg.addEventListener('close',()=>dlg.remove());
  if(editable){dlg.querySelector('#releaseWholeRoute').onclick=()=>{dlg.close();manageRoute(id,'release')};}
  if(editable)dlg.addEventListener('click',async e=>{
   const b=e.target.closest('[data-stop-release],[data-stop-cancel],[data-stop-confirm]');if(!b)return;
   const stopId=b.dataset.stopRelease||b.dataset.stopCancel||b.dataset.stopUnpaid||b.dataset.stopConfirm;
   const isConfirm=!!b.dataset.stopConfirm;
   const choice=b.dataset.stopRelease?'release':'cancel_paid';
   const st=state.paradas.find(x=>x.id===stopId);const order=state.pedidos.find(x=>x.id===st?.pedido_id);
   const description=isConfirm?'CONFIRMAR ENTREGA (mesmo distante)':choice==='release'?'RETIRAR o pedido da rota, devolvendo aos pendentes':choice==='cancel'?'CANCELAR SEM PAGAR o motoboy':'CANCELAR E PAGAR R$ 10 ao motoboy';
   if(!order||!confirm(`${description} para o pedido #${order.numero||''} de ${order.cliente_nome}?\n\nA ação afeta somente este pedido.`))return;
   b.disabled=true;
   try {
    const {data,error}=await sb.rpc(isConfirm?'rota_confirmar_entrega_painel':'rota_gerenciar_pedido',isConfirm?{p_rota_id:id,p_pedido_id:order.id}:{p_rota_id:id,p_pedido_id:order.id,p_acao:choice});
    if(error)throw error;
    if(data && typeof data==='object' && (data.ok===false || data.sucesso===false))throw Error(data.mensagem||data.erro||'Operação recusada pelo Supabase');
    await fetchAll();
    const atualizado=state.pedidos.find(p=>p.id===order.id);
    const esperados=isConfirm?['entregue','finalizado','concluido','concluído']:choice==='release'?['pendente','disponivel','disponível']:['cancelado','cancelada'];
    if(atualizado && !esperados.includes(String(atualizado.status||'').toLowerCase())){
     toast('Ação enviada, mas o pedido ainda está '+(atualizado.status||'sem status')+'. Verifique a função no Supabase antes de repetir.',true);
     b.disabled=false;return;
    }
    dlg.close();
    toast(isConfirm?'Entrega confirmada no painel.':choice==='release'?'Pedido devolvido aos disponíveis.':choice==='cancel'?'Pedido cancelado sem remuneração.':'Pedido cancelado com remuneração de R$ 10.');
    manageRoute(id,'actions');
   }catch(err){toast('Não foi possível executar: '+errorText(err),true);b.disabled=false;}
  });return;
 }
 const pending=orders.filter(p=>p.status==='em_rota');
 const title=action==='release'?'RETIRAR a rota e devolver pedidos não concluídos à loja':'CANCELAR os pedidos ainda não concluídos';
 if(!confirm(`${title}?\n\nRota #${id.slice(0,8)}\n${pending.length} pedido(s) ainda em rota.\nEntregas concluídas serão preservadas.`))return;
 const {data,error}=await sb.rpc('rota_gerenciar_despacho',{p_rota_id:id,p_acao:action});
 if(error){toast('Não foi possível gerenciar rota: '+errorText(error),true);return}
 toast(action==='release'?'Rota retirada; pedidos pendentes liberados.':'Pedidos pendentes cancelados.');await fetchAll();
}
$('routesList').addEventListener('click',e=>{
 const btn=e.target.closest('[data-route-detail],[data-route-actions],[data-route-release]');if(!btn)return;
 const id=btn.dataset.routeDetail||btn.dataset.routeActions||btn.dataset.routeRelease;
 const action=btn.dataset.routeDetail?'detail':btn.dataset.routeActions?'actions':'release';manageRoute(id,action);
});
$('goImportOrders').onclick=()=>page('pedidos');$('ordersTable').onclick=async e=>{
 const btn=e.target.closest('[data-cancel],[data-order-detail]');if(!btn)return;
 const id=btn.dataset.cancel||btn.dataset.orderDetail;
 const order=state.pedidos.find(p=>p.id===id);if(!order)return;
 if(btn.dataset.orderDetail){const st=[...state.paradas].reverse().find(x=>x.pedido_id===id);if(st)manageRoute(st.rota_id,'detail');else toast('Rota não encontrada para este pedido.',true);return;}
 if(!confirm('Cancelar este pedido sem pagamento e preservar o histórico?'))return;
 btn.disabled=true;const {error}=await sb.rpc('rota_cancelar_pedidos_loja',{p_empresa_id:state.empresa.id,p_loja_id:order.loja_id,p_pedido_ids:[id]});
 if(error){toast(errorText(error),true);btn.disabled=false;}else{toast('Pedido cancelado sem pagamento.');await fetchAll()}
};
// Financeiro administrativo: leitura por empresa, sem misturar recebimento do cliente.
const moneyRF=n=>Number(n||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
async function loadFinance(){
 if(!state.empresa)return;
 const {data,error}=await sb.from('historico_entregas_motoboy')
  .select('motoboy_id,local_id,dados,salvo_em,atualizado_em,excluido_em')
  .eq('empresa_id',state.empresa.id).order('salvo_em',{ascending:false}).limit(10000);
 if(error){toast('Histórico financeiro: '+error.message,true);return}
 // O historico sincronizado do Android e a fonte principal. Nunca somar
 // novamente os mesmos pedidos a partir de financeiro_corridas_motoboy.
 // Consolidar versoes do mesmo pedido remoto, mantendo a mais recente finalizada.
 const latest=new Map();
 const {data:removed,error:removedError}=await sb.from('rota_corridas_removidas').select('motoboy_id,registro_id,pedido_id').eq('empresa_id',state.empresa.id);
 if(removedError){toast('Não foi possível verificar corridas removidas: '+removedError.message,true);return}
 const excluded=new Set((removed||[]).map(r=>`${r.motoboy_id}|${r.registro_id}`));
 const excludedPedidos=new Set((removed||[]).filter(r=>r.pedido_id).map(r=>`${r.motoboy_id}|${r.pedido_id}`));
 for(const x of (data||[]).filter(r=>!r.excluido_em && !excluded.has(`${r.motoboy_id}|historico:${r.local_id}`) && !excludedPedidos.has(`${r.motoboy_id}|${r.dados?.remotePedidoId||''}`))){
   const d=x.dados||{};
   const key=d.remotePedidoId?`${x.motoboy_id}|remote|${d.remotePedidoId}`:`${x.motoboy_id}|local|${x.local_id}`;
   const previous=latest.get(key);
   const rank=r=>[(r.dados?.delivered===true||r.dados?.cancelled===true)?1:0,Date.parse(r.atualizado_em||r.salvo_em||0)];
   if(!previous || rank(x)[0]>rank(previous)[0] || (rank(x)[0]===rank(previous)[0] && rank(x)[1]>rank(previous)[1]))latest.set(key,x);
 }
 state.finance=[...latest.values()].filter(x=>x.dados?.delivered===true||x.dados?.cancelled===true).map(x=>{
   const d=x.dados||{};const raw=Number(d.value),ret=Number(d.returnValue||0);
   const fora=String(d.platform||'').toLowerCase()==='outro' && (String(d.reference||'').includes('[CORRIDA POR FORA]')||String(d.customer||'').toLowerCase().includes('serviço por fora'));
   const tipo=fora?'fora':d.cancelled===true?'cancelada':ret>0?'retorno':'normal';
   return {motoboy_id:x.motoboy_id,local_id:x.local_id,
     pedido_id:d.remotePedidoId||'',pedido_numero:String(d.order??''),cliente:String(d.customer??''),
     resultado:tipo==='fora'?'Corrida por fora':tipo==='cancelada'?'Cancelada remunerada':tipo==='retorno'?'Retorno remunerado':'Entrega normal',tipo,
     retorno:Number.isFinite(ret)?ret:0,nota_retorno:String(d.returnNote||''),
     valor:(Number.isFinite(raw)?raw:0)+(Number.isFinite(ret)?ret:0),
     registrado_em:x.salvo_em||x.atualizado_em||new Date(0).toISOString(),
     work_day:Number(d.startedAt)||Number(d.workDay)||Number(d.createdAt)||0,
     started_at:Number(d.startedAt)||0,finished_at:Number(d.finishedAt)||0};
 });
 // Complementar com lançamentos registrados diretamente no financeiro do Supabase.
 // A mesma entrega com ID remoto no histórico Android prevalece, sem dupla soma.
 const {data:ledger,error:ledgerError}=await sb.from('financeiro_corridas_motoboy')
  .select('motoboy_id,pedido_id,rota_id,resultado,valor,registrado_em')
  .eq('empresa_id',state.empresa.id).order('registrado_em',{ascending:false}).limit(10000);
 if(ledgerError){toast('Lançamentos financeiros: '+ledgerError.message,true)}
 else {
  const known=new Set(state.finance.filter(x=>x.pedido_id).map(x=>`${x.motoboy_id}|${x.pedido_id}`));
  const ledgerSeen=new Set();
  const ordersById=new Map(state.pedidos.map(p=>[String(p.id),p]));
  for(const f of ledger||[]){
   const pid=String(f.pedido_id||'');
   const key=`${f.motoboy_id}|${pid}`;
   if(!pid||known.has(key)||ledgerSeen.has(key)||excluded.has(`${f.motoboy_id}|financeiro:${pid}`)||excludedPedidos.has(key))continue;
   ledgerSeen.add(key);
   const order=ordersById.get(pid);
   const cancelled=String(f.resultado||'').toLowerCase().includes('cancelado');
   const tipo=cancelled?'cancelada':'normal';
   state.finance.push({motoboy_id:f.motoboy_id,local_id:'financeiro:'+pid,
    pedido_id:pid,pedido_numero:String(order?.numero??pid.slice(0,8)),
    cliente:String(order?.cliente_nome??''),
    resultado:cancelled?'Cancelada remunerada':'Entrega remunerada',tipo,
    retorno:0,nota_retorno:'',valor:Number(f.valor||0),
    registrado_em:f.registrado_em||new Date(0).toISOString(),
    work_day:Date.parse(f.registrado_em||'')||0,started_at:0,finished_at:0});
  }
 }
 renderFinance();
}
// Datas de trabalho do Android em milissegundos; fechamento em horário de Brasília.
const rfDateFmt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'});
const rfDay=t=>rfDateFmt.format(new Date(t));
function rfMonday(dateStr){
 const [y,m,d]=dateStr.split('-').map(Number);const dt=new Date(Date.UTC(y,m-1,d));
 const offset=(dt.getUTCDay()+6)%7;dt.setUTCDate(dt.getUTCDate()-offset);return dt.toISOString().slice(0,10);
}
function rfAddDays(dateStr,days){const d=new Date(dateStr+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
function rfBR(dateStr){return dateStr.split('-').reverse().join('/')}
function rfCycleStart(x){return rfMonday(rfDay(x.work_day||Date.parse(x.registrado_em)))}
function rfSelectedCycle(){const val=$('financeCycle')?.value||'atual';const now=rfMonday(rfDay(Date.now()));return val==='atual'?now:val==='anterior'?rfAddDays(now,-7):val==='todos'?'':val}
function financeFiltered(){
 const driver=$('financeDriver')?.value||'';const from=$('financeFrom')?.value||'';const to=$('financeTo')?.value||'';const tipo=$('financeType')?.value||'';const cycle=rfSelectedCycle();
 return (state.finance||[]).filter(x=>{const day=rfDay(x.work_day||Date.parse(x.registrado_em));return (!driver||x.motoboy_id===driver)&&(!from||day>=from)&&(!to||day<=to)&&(!tipo||x.tipo===tipo)&&(!cycle||rfMonday(day)===cycle)});
}
function renderFinance(){
 if(!$('financeDriver'))return;
 const sel=$('financeDriver');const previous=sel.value;
 sel.innerHTML='<option value="">Todos</option>'+state.motoboys.map(m=>`<option value="${esc(m.id)}">${esc(m.nome)}</option>`).join('');sel.value=previous;
 const cycleSelect=$('financeCycle');const selected=cycleSelect.value||'atual';const monday=rfMonday(rfDay(Date.now()));
 cycleSelect.innerHTML='<option value="atual">Ciclo atual</option><option value="anterior">Último ciclo fechado (a pagar)</option>'+Array.from({length:12},(_,i)=>{const start=rfAddDays(monday,-7*(i+2));return `<option value="${start}">${rfBR(start)} a ${rfBR(rfAddDays(start,6))}</option>`}).join('')+'<option value="todos">Histórico completo</option>';
 cycleSelect.value=selected;if(!cycleSelect.value)cycleSelect.value='atual';
 const cycle=rfSelectedCycle();const end=cycle?rfAddDays(cycle,6):'';const payday=cycle?rfAddDays(cycle,9):'';
 $('financeCycleInfo').textContent=cycle?`Período: ${rfBR(cycle)} a ${rfBR(end)} · Pagamento previsto: quarta-feira, ${rfBR(payday)} · ${cycle===monday?'Em andamento':'Encerrado (pagamento não confirmado)'}`:'Histórico completo — todos os ciclos';
 const rows=financeFiltered();$('financeCount').textContent=rows.length;$('financeTotal').textContent=moneyRF(rows.reduce((n,x)=>n+Number(x.valor||0),0));
 const name=id=>state.motoboys.find(m=>m.id===id)?.nome||id;
 const summary=new Map();for(const x of rows){const v=summary.get(x.motoboy_id)||{n:0,total:0};v.n++;v.total+=Number(x.valor||0);summary.set(x.motoboy_id,v)}
 $('financeByDriver').innerHTML='<table><thead><tr><th>Motoboy</th><th>Corridas</th><th>Total</th></tr></thead><tbody>'+[...summary].map(([id,v])=>`<tr><td>${esc(name(id))}</td><td>${v.n}</td><td>${moneyRF(v.total)}</td></tr>`).join('')+'</tbody></table>';
 const dateTime=ms=>ms?new Intl.DateTimeFormat('pt-BR',{timeZone:'America/Sao_Paulo',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(ms)):'Não registrado';
 const duration=x=>x.started_at&&x.finished_at&&x.finished_at>=x.started_at?Math.floor((x.finished_at-x.started_at)/60000)+' min':'—';
 const daily=new Map();for(const x of rows){const day=rfDay(x.work_day||Date.parse(x.registrado_em));const v=daily.get(day)||{count:0,total:0,normal:0,retorno:0,cancelada:0,fora:0};v.count++;v.total+=x.valor;v[x.tipo]++;daily.set(day,v)}
 $('financeDaily').innerHTML='<table><thead><tr><th>Dia de trabalho</th><th>Corridas</th><th>Normais</th><th>Retornos</th><th>Canceladas pagas</th><th>Por fora</th><th>Total</th></tr></thead><tbody>'+[...daily].sort((a,b)=>b[0].localeCompare(a[0])).map(([day,v])=>`<tr><td>${rfBR(day)}</td><td>${v.count}</td><td>${v.normal}</td><td>${v.retorno}</td><td>${v.cancelada}</td><td>${v.fora}</td><td>${moneyRF(v.total)}</td></tr>`).join('')+'</tbody></table>';
 $('financeRows').innerHTML='<table><thead><tr><th>Dia contabilizado</th><th>Motoboy</th><th>Pedido / Cliente</th><th>Início</th><th>Finalização</th><th>Duração</th><th>Resultado</th><th>Taxa</th><th>Ação</th></tr></thead><tbody>'+rows.sort((a,b)=>b.work_day-a.work_day).map(x=>`<tr class="rf-fin-${x.tipo}"><td>${rfBR(rfDay(x.work_day||Date.parse(x.registrado_em)))}</td><td>${esc(name(x.motoboy_id))}</td><td>#${esc(x.pedido_numero)} — ${esc(x.cliente)}</td><td>${dateTime(x.started_at)}</td><td>${dateTime(x.finished_at)}</td><td>${duration(x)}</td><td>${esc(x.resultado)}${x.retorno>0?' (+'+moneyRF(x.retorno)+')':''}</td><td>${moneyRF(x.valor)}</td><td>${state.papel==='proprietario'?`<button type="button" class="secondary" data-remove-fin="${esc(x.local_id.startsWith('financeiro:')?'financeiro':'historico')}" data-remove-id="${esc(x.local_id)}" data-remove-driver="${esc(x.motoboy_id)}" data-remove-order="${esc(x.pedido_id||'')}">Remover corrida</button>`:'—'}</td></tr>`).join('')+'</tbody></table';
}
$('financeRows').addEventListener('click',async e=>{
 const b=e.target.closest('[data-remove-fin]');if(!b)return;
 if(state.papel!=='proprietario')return toast('Somente o proprietário pode remover corridas.',true);
 const row=state.finance.find(x=>x.local_id===b.dataset.removeId&&x.motoboy_id===b.dataset.removeDriver);
 if(!row)return toast('Corrida não encontrada. Atualize o financeiro.',true);
 const driver=state.motoboys.find(x=>x.id===row.motoboy_id)?.nome||'motoboy';
 if(!confirm(`Remover a corrida #${row.pedido_numero} de ${driver}, no valor de ${moneyRF(row.valor)}?\n\nEla deixará de contar no financeiro, mas ficará preservada para auditoria.`))return;
 const motivo=prompt('Informe o motivo da remoção (obrigatório):');if(!motivo?.trim())return;
 b.disabled=true;
 const {error}=await sb.rpc('rota_remover_corrida_financeira',{p_empresa:state.empresa.id,p_motoboy:row.motoboy_id,p_registro:row.local_id,p_pedido:row.pedido_id||null,p_motivo:motivo.trim()});
 if(error){b.disabled=false;return toast('Não foi possível remover: '+error.message,true)}
 toast('Corrida removida do financeiro.');await loadFinance();
});
$('financeRefresh').onclick=loadFinance;
for(const id of ['financeDriver','financeFrom','financeTo','financeType','financeCycle'])$(id).addEventListener('change',renderFinance);
$('financeCsv').onclick=()=>{
 const rows=financeFiltered();const quote=v=>'"'+String(v??'').replaceAll('"','""')+'"';const lines=[['dia_contabilizado','motoboy','pedido','cliente','inicio_ms','fim_ms','duracao_min','resultado','valor'],...rows.map(x=>[rfDay(x.work_day||Date.parse(x.registrado_em)),state.motoboys.find(m=>m.id===x.motoboy_id)?.nome||x.motoboy_id,x.pedido_numero,x.cliente,x.started_at||'',x.finished_at||'',x.started_at&&x.finished_at?Math.floor((x.finished_at-x.started_at)/60000):'',x.resultado,x.valor])];
 const blob=new Blob(['\ufeff'+lines.map(r=>r.map(quote).join(';')).join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='rota-facil-financeiro.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};

// Recuperação de senha do Supabase (link enviado por e-mail).
let recoveryMode = false;
function showRecovery(){
  recoveryMode=true;
  $('login').classList.add('hidden');
  $('app').classList.add('hidden');
  $('resetScreen').classList.remove('hidden');
}
$('forgotPassword').addEventListener('click',async()=>{
  const email=$('email').value.trim();
  if(!email){$('loginError').textContent='Digite seu e-mail no campo acima e clique novamente em Esqueci minha senha.';return}
  $('loginError').textContent='Enviando link de recuperação...';
  const redirectTo=new URL('index.html',window.location.href).href;
  const {error}=await sb.auth.resetPasswordForEmail(email,{redirectTo});
  $('loginError').textContent=error?error.message:'Se o e-mail estiver cadastrado, você receberá um link para criar outra senha.';
});
$('resetForm').addEventListener('submit',async ev=>{
  ev.preventDefault();
  const pass=$('newPassword').value;
  if(pass!==$('confirmPassword').value){$('resetError').textContent='As senhas não são iguais.';return}
  $('resetError').textContent='Salvando...';
  const {error}=await sb.auth.updateUser({password:pass});
  if(error){$('resetError').textContent=error.message;return}
  $('resetError').textContent='Senha atualizada! Redirecionando para o painel...';
  recoveryMode=false;
  history.replaceState(null,'',location.pathname);
  $('resetScreen').classList.add('hidden');
  await start();
});
sb.auth.onAuthStateChange((event)=>{
  if(event==='PASSWORD_RECOVERY')showRecovery();
});
// Aguarda o Supabase processar os tokens da URL antes de exibir o login.
const recoveryLink=/[?#&](type=recovery|token_hash=|access_token=|code=)/.test(location.href);
if(recoveryLink){
  showRecovery();
  // PKCE e links inválidos podem não gerar sessão; exibir instrução em vez de aceitar senha sem sessão.
  sb.auth.getSession().then(({data:{session},error})=>{
    if(error||!session){
      $('resetError').textContent='Link inválido ou expirado. Volte à tela de login e solicite um novo e-mail.';
      $('resetForm').querySelector('button[type=submit]').disabled=true;
    }
  });
}else{start().catch(e=>toast(errorText(e),true));}


// Atualizações: somente administradores explicitamente cadastrados no Supabase.
let updateAdmin=false;
async function checkUpdateAdmin(){
 const {data,error}=await sb.rpc('rota_e_admin_atualizacoes');
 updateAdmin=!error&&data===true;
 $('updatesNav').classList.toggle('hidden',!updateAdmin);
 if(!updateAdmin&&state.page==='atualizacoes')page('inicio');
}
async function loadUpdates(){
 if(!updateAdmin)return;
 const el=$('updatesList');el.textContent='Carregando versões...';
 const {data,error}=await sb.from('app_atualizacoes').select('id,aplicativo,versao,version_code,canal,obrigatoria,notas,publicada_em,arquivo_path').order('publicada_em',{ascending:false}).limit(100);
 if(error){el.textContent='Erro: '+error.message;return}
 if(!data?.length){el.textContent='Nenhuma versão publicada.';return}
 el.innerHTML=`<table><thead><tr><th>Aplicativo</th><th>Versão</th><th>Canal</th><th>Obrigatória</th><th>Publicação</th><th>APK</th></tr></thead><tbody>${data.map(v=>`<tr><td>${esc(v.aplicativo)}</td><td>${esc(v.versao)} (#${Number(v.version_code)})</td><td>${esc(v.canal)}</td><td>${v.obrigatoria?'Sim':'Não'}</td><td>${fmt(v.publicada_em)}</td><td><button class="secondary" data-update-download="${esc(v.id)}">Baixar</button></td></tr>`).join('')}</tbody></table>`;
 el.querySelectorAll('[data-update-download]').forEach(b=>b.onclick=async()=>{
  const v=data.find(x=>x.id===b.dataset.updateDownload);if(!v)return;
  const {data:link,error:e}=await sb.storage.from('rota-facil-apks').createSignedUrl(v.arquivo_path,120);
  if(e){toast('Falha ao gerar link: '+e.message,true);return}
  window.open(link.signedUrl,'_blank','noopener,noreferrer');
 });
}
$('updatesRefresh').onclick=loadUpdates;
$('updatesForm').addEventListener('submit',async e=>{
 e.preventDefault();if(!updateAdmin)return;
 const file=$('updateFile').files?.[0];const feedback=$('updateFeedback');
 if(!file||!file.name.toLowerCase().endsWith('.apk')){feedback.textContent='Selecione um arquivo .apk';return}
 const aplicativo=$('updateApp').value, versao=$('updateVersion').value.trim(),version_code=Number($('updateCode').value),canal=$('updateChannel').value;
 if(!/^\d+\.\d+\.\d+(?:[.-][a-zA-Z0-9.-]+)?$/.test(versao)||!Number.isSafeInteger(version_code)||version_code<1){feedback.textContent='Informe versão e versionCode válidos.';return}
 const button=$('updatePublish');button.disabled=true;feedback.textContent='Verificando versão...';
 let path=null;
 try{
  const {data:older,error:readError}=await sb.from('app_atualizacoes').select('version_code').eq('aplicativo',aplicativo).order('version_code',{ascending:false}).limit(1);
  if(readError)throw readError;
  if(older?.length&&version_code<=older[0].version_code)throw Error('VersionCode precisa ser maior que '+older[0].version_code);
  path=`${aplicativo}/${crypto.randomUUID()}.apk`;
  feedback.textContent='Enviando APK ao Supabase...';
  const {error:uploadError}=await sb.storage.from('rota-facil-apks').upload(path,file,{contentType:'application/vnd.android.package-archive',upsert:false});
  if(uploadError)throw uploadError;
  const {error:insertError}=await sb.from('app_atualizacoes').insert({aplicativo,versao,version_code,canal,obrigatoria:$('updateRequired').checked,notas:$('updateNotes').value.trim(),arquivo_path:path,tamanho_bytes:file.size});
  if(insertError)throw insertError;
  feedback.textContent='Versão publicada com sucesso!';$('updatesForm').reset();await loadUpdates();
 }catch(err){feedback.textContent='Não foi possível publicar: '+errorText(err);toast(errorText(err),true);
  if(path)await sb.storage.from('rota-facil-apks').remove([path]);
 }finally{button.disabled=false}
});
