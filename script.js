(() => {
  const KEY='cont_issues_tracker_v3', OWNER='sis-inf';
  const REPOS={'CHUSPASOCIAL':'ChuspaSocial','CHUSPAPULSE':'ChuspaPulse','SIS-INF':'sis-inf','CHUSPACALC':'ChuspaCalc','CHUSPANUMERIC':'ChuspaNumeric','CHUSPADB':'ChuspaDB'};
  const names=Object.keys(REPOS), $=id=>document.getElementById(id);
  const fresh=()=>({cfg:{user:'',token:''},repos:Object.fromEntries(names.map(n=>[n,{done:0,assigned:0,review:0,merged:0}])),errors:{},detail:[],syncedAt:null});
  let state=load(),syncing=false;
  function load(){try{const s=JSON.parse(localStorage.getItem(KEY)||'null'),d=fresh();if(!s)return d;return {...d,...s,cfg:{...d.cfg,...s.cfg},repos:{...d.repos,...s.repos},errors:{}};}catch(e){return fresh();}}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify({...state,cfg:{...state.cfg,token:''}}));}catch(e){}}
  const total=()=>names.reduce((a,n)=>a+(state.repos[n]?.done||0),0);
  const norm=x=>String(x).toLowerCase().replace(/[^a-z0-9]/g,'');
  const esc=x=>String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function toast(m){const el=$('toast');el.textContent=m;el.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',2800);}
  function setStatus(m,bad=false){const el=$('status');el.textContent=m;el.className='status'+(bad?' bad':'');}
  // Las búsquedas de GitHub aceptan consultas sin token (10 por minuto). Una sincronización usa 4.
  // Si el token falla (401/404 por falta de acceso a la organización), se reintenta sin token.
  async function api(path){
    const call=async useToken=>{
      const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
      if(useToken&&state.cfg.token)headers.Authorization='Bearer '+state.cfg.token;
      return fetch('https://api.github.com'+path,{headers});
    };
    let r=await call(true);
    if(state.cfg.token&&(r.status===401||r.status===404)){r=await call(false);api.tokenIgnored=true;}
    if(r.status===403||r.status===429){
      const reset=r.headers.get('x-ratelimit-reset');
      const when=reset?new Date(Number(reset)*1000).toLocaleTimeString():'unos minutos';
      throw new Error('Límite de consultas de GitHub alcanzado. Vuelve a intentarlo a las '+when+'.');
    }
    if(r.status===422)throw new Error('GitHub rechazó la búsqueda. Revisa que el usuario esté bien escrito.');
    if(!r.ok)throw new Error('GitHub respondió con error '+r.status+'.');
    return r.json();
  }
  async function searchAll(query,maxPages){
    const items=[];
    for(let page=1;page<=maxPages;page++){
      const data=await api('/search/issues?per_page=100&page='+page+'&q='+encodeURIComponent(query));
      items.push(...data.items);
      if(items.length>=data.total_count||data.items.length<100)break;
    }
    return items;
  }
  const labelOf=it=>{const repo=it.repository_url.split('/').pop();return names.find(n=>norm(REPOS[n])===norm(repo));};
  function renderRepos(){
    $('repos').innerHTML=names.map((n,i)=>'<article class="repo"><div class="repo-top"><h3>'+esc(n)+'</h3><div class="repo-icon">'+String(i+1).padStart(2,'0')+'</div></div><div class="count" id="count-'+i+'">0</div><small id="msg-'+i+'">Issues cerrados</small><div class="repo-mini" id="mini-'+i+'"></div></article>').join('');
  }
  function render(){
    names.forEach((n,i)=>{const r=state.repos[n]||{done:0,assigned:0,review:0,merged:0};$('count-'+i).textContent=r.done||0;$('msg-'+i).textContent=state.errors[n]||'Issues cerrados asignados a ti';$('msg-'+i).className=state.errors[n]?'err':'';$('mini-'+i).textContent=(r.assigned||0)+' pendientes · '+(r.review||0)+' PR abiertos';});
    const t=total(),left=Math.max(0,40-t),pct=Math.round(t/40*100);
    $('total').textContent=t;$('remaining').textContent=left;$('goalHint').textContent=t>=40?(t===40?'¡Mínimo alcanzado!':'Mínimo superado por '+(t-40)):'Issues para alcanzar el mínimo';
    $('percent').textContent=pct+'%';$('progress').style.width=Math.min(100,pct)+'%';
    $('assigned').textContent=names.reduce((a,n)=>a+(state.repos[n]?.assigned||0),0);
    $('review').textContent=names.reduce((a,n)=>a+(state.repos[n]?.review||0),0);
    $('merged').textContent=names.reduce((a,n)=>a+(state.repos[n]?.merged||0),0);
    $('syncedAt').textContent=state.syncedAt?'Sincronizado: '+new Date(state.syncedAt).toLocaleString():'Sin sincronizar';
    $('user').value=state.cfg.user;$('token').value=state.cfg.token;renderDetail();
  }
  function renderDetail(){
    const term=($('filterText')?.value||'').toLowerCase().trim(),status=$('filterStatus')?.value||'all';
    const rows=state.detail.filter(x=>(status==='all'||x.status===status)&&(!term||(x.title+' '+x.repo+' '+x.number).toLowerCase().includes(term)));
    $('detailCount').textContent=rows.length+' resultados';
    $('detailList').innerHTML=rows.length?rows.map(x=>'<article class="issue-row"><div class="issue-main"><div class="issue-title"><a href="'+esc(x.url)+'" target="_blank" rel="noopener">#'+x.number+' · '+esc(x.title)+'</a></div><div class="issue-meta">'+esc(x.repo)+' · '+esc(x.statusLabel)+(x.prUrl?' · <a href="'+esc(x.prUrl)+'" target="_blank" rel="noopener">Ver PR fusionado</a>':'')+'</div></div><span class="pill '+(x.status==='done'?'pill-done':x.status==='review'?'pill-review':'pill-pending')+'">'+esc(x.statusLabel)+'</span></article>').join(''):'<p class="empty">No hay resultados para este filtro. Sincroniza para actualizar los datos.</p>';
  }
  async function sync(manual){
    const user=state.cfg.user;if(!user){if(manual)setStatus('Escribe tu usuario de GitHub primero.',true);return;}
    if(syncing)return;syncing=true;$('syncBtn').disabled=true;setStatus('Consultando GitHub…');state.errors={};api.tokenIgnored=false;
    try{
      const repoQ=names.map(n=>'repo:'+OWNER+'/'+REPOS[n]).join(' ');
      // «Hecho» = issues (y PRs) asignados a ti que ya están cerrados o fusionados
      const closed =await searchAll(repoQ+' is:closed assignee:'+user,5);
      const pending=await searchAll(repoQ+' is:issue is:open assignee:'+user,2);
      const review =await searchAll(repoQ+' is:pr is:open author:'+user,2);
      const merged =await searchAll(repoQ+' is:pr is:merged author:'+user,3);

      const newRepos=Object.fromEntries(names.map(n=>[n,{done:0,assigned:0,review:0,merged:0}])),detail=[];
      const add=(it,status,statusLabel)=>{const label=labelOf(it);if(!label)return null;detail.push({number:it.number,title:it.title,url:it.html_url,repo:label,status,statusLabel});return label;};
      for(const it of closed){const l=add(it,'done',it.pull_request?'PR cerrado/fusionado':'Cerrado');if(l)newRepos[l].done++;}
      for(const it of pending){const l=add(it,'pending','Pendiente');if(l)newRepos[l].assigned++;}
      for(const it of review){const l=add(it,'review','PR abierto/en revisión');if(l)newRepos[l].review++;}
      for(const it of merged){const l=labelOf(it);if(l)newRepos[l].merged++;}

      state.repos=newRepos;state.detail=detail;state.syncedAt=Date.now();persist();render();
      setStatus('✓ Sincronización completada'+(api.tokenIgnored?' (el token no tenía acceso; se usó sin token)':''));
      if(manual)toast('Datos actualizados correctamente.');
    }catch(e){
      names.forEach(n=>state.errors[n]=e.message);render();setStatus(e.message,true);
    }finally{syncing=false;$('syncBtn').disabled=false;}
  }
  $('saveBtn').addEventListener('click',()=>{state.cfg={user:$('user').value.trim().replace(/^@/,''),token:$('token').value.trim()};persist();sync(true);});
  $('syncBtn').addEventListener('click',()=>sync(true));
  $('exportBtn').addEventListener('click',()=>{const {token,...cfg}=state.cfg;const blob=new Blob([JSON.stringify({...state,cfg,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cont-issues-backup.json';a.click();URL.revokeObjectURL(url);toast('Copia exportada sin token.');});
  $('resetBtn').addEventListener('click',()=>{if(confirm('¿Borrar contadores y configuración guardada?')){state=fresh();persist();render();setStatus('');toast('Datos reiniciados.');}});
  $('filterText').addEventListener('input',renderDetail);$('filterStatus').addEventListener('change',renderDetail);
  renderRepos();render();if(!state.syncedAt||Date.now()-state.syncedAt>30*60*1000)sync(false);
  setInterval(()=>sync(false),30*60*1000);
})();