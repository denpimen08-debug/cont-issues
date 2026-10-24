(() => {
  const KEY = 'cont_issues_tracker_v3';
  const OWNER = 'sis-inf';
  const REPOS = {
    'CHUSPASOCIAL':'ChuspaSocial',
    'CHUSPAPULSE':'ChuspaPulse',
    'SIS-INF':'sis-inf',
    'CHUSPACALC':'ChuspaCalc',
    'CHUSPANUMERIC':'ChuspaNumeric',
    'CHUSPADB':'ChuspaDB'
  };
  const names = Object.keys(REPOS);
  const $ = id => document.getElementById(id);
  const fresh = () => ({
    cfg:{user:'',token:''}, repos:Object.fromEntries(names.map(n=>[n,{done:0,assigned:0,review:0,merged:0}])),
    errors:{}, detail:[], syncedAt:null
  });
  let state = load(), syncing = false;
  function load(){
    try{
      const s=JSON.parse(localStorage.getItem(KEY)||'null'), d=fresh();
      if(!s) return d;
      return {...d,...s,cfg:{...d.cfg,...s.cfg},repos:{...d.repos,...s.repos},errors:{}};
    }catch(e){return fresh();}
  }
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){}}
  const total = () => names.reduce((a,n)=>a+(state.repos[n]?.done||0),0);
  const norm = x => String(x).toLowerCase().replace(/[^a-z0-9]/g,'');
  const esc = x => String(x??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  function toast(m){const el=$('toast');el.textContent=m;el.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',2800);}
  function setStatus(m,bad=false){const el=$('status');el.textContent=m;el.className='status'+(bad?' bad':'');}
  async function api(path){
    const headers={'Accept':'application/vnd.github+json'};
    if(state.cfg.token) headers.Authorization='Bearer '+state.cfg.token;
    const r=await fetch('https://api.github.com'+path,{headers});
    if(r.status===403||r.status===429) throw new Error('Límite de GitHub alcanzado. Espera un momento o usa un token con permisos mínimos.');
    if(r.status===401) throw new Error('Token inválido. Revisa el token o déjalo vacío si los repositorios son públicos.');
    if(r.status===404){const e=new Error('Repositorio no encontrado o sin permisos.');e.notFound=true;throw e;}
    if(!r.ok) throw new Error('GitHub respondió con error '+r.status+'.');
    return r.json();
  }
  const search = (q,per=100,page=1) => api('/search/issues?per_page='+per+'&page='+page+'&q='+encodeURIComponent(q));
  function renderRepos(){
    $('repos').innerHTML=names.map((n,i)=>'<article class="repo"><div class="repo-top"><h3>'+esc(n)+'</h3><div class="repo-icon">'+String(i+1).padStart(2,'0')+'</div></div><div class="count" id="count-'+i+'">0</div><small id="msg-'+i+'">Issues verificados</small><div class="repo-mini" id="mini-'+i+'"></div></article>').join('');
  }
  function render(){
    names.forEach((n,i)=>{
      const r=state.repos[n]||{done:0,assigned:0,review:0,merged:0};
      $('count-'+i).textContent=r.done||0;
      $('msg-'+i).textContent=state.errors[n]||'Issues verificados con PR fusionado';
      $('msg-'+i).className=state.errors[n]?'err':'';
      $('mini-'+i).textContent=(r.assigned||0)+' pendientes · '+(r.review||0)+' PR abiertos';
    });
    const t=total(),left=Math.max(0,40-t),pct=Math.round(t/40*100);
    $('total').textContent=t;$('remaining').textContent=left;
    $('goalHint').textContent=t>=40?(t===40?'¡Mínimo alcanzado!':'Mínimo superado por '+(t-40)):'Issues para alcanzar el mínimo';
    $('percent').textContent=pct+'%';$('progress').style.width=Math.min(100,pct)+'%';
    $('assigned').textContent=names.reduce((a,n)=>a+(state.repos[n]?.assigned||0),0);
    $('review').textContent=names.reduce((a,n)=>a+(state.repos[n]?.review||0),0);
    $('merged').textContent=names.reduce((a,n)=>a+(state.repos[n]?.merged||0),0);
    $('syncedAt').textContent=state.syncedAt?'Sincronizado: '+new Date(state.syncedAt).toLocaleString():'Sin sincronizar';
    $('user').value=state.cfg.user;$('token').value=state.cfg.token;
    renderDetail();
  }
  function renderDetail(){
    const term=($('filterText')?.value||'').toLowerCase().trim();
    const status=$('filterStatus')?.value||'all';
    const rows=state.detail.filter(x=>(status==='all'||x.status===status)&&(!term||(x.title+' '+x.repo+' '+x.number).toLowerCase().includes(term)));
    $('detailCount').textContent=rows.length+' resultados';
    $('detailList').innerHTML=rows.length?rows.map(x=>'<article class="issue-row"><div class="issue-main"><div class="issue-title"><a href="'+esc(x.url)+'" target="_blank" rel="noopener">#'+x.number+' · '+esc(x.title)+'</a></div><div class="issue-meta">'+esc(x.repo)+' · '+esc(x.statusLabel)+(x.prUrl?' · <a href="'+esc(x.prUrl)+'" target="_blank" rel="noopener">Ver PR fusionado</a>':'')+'</div></div><span class="pill '+(x.status==='done'?'pill-done':x.status==='review'?'pill-review':'pill-pending')+'">'+esc(x.statusLabel)+'</span></article>').join(''):'<p class="empty">No hay resultados para este filtro. Sincroniza para actualizar los datos.</p>';
  }
  // Cuenta solo referencias de cierre estándar de GitHub en PRs fusionados.
  function closingRefs(text){
    const refs=new Set(), re=/(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+(?:(?:[\w.-]+)\/[\w.-]+)?#(\d+)/gi;
    let m;while((m=re.exec(text||''))!==null) refs.add(Number(m[1]));
    return refs;
  }
  async function fetchAll(q){
    const out=[];
    for(let page=1;page<=10;page++){
      const data=await search(q,100,page);out.push(...data.items);
      if(out.length>=data.total_count||data.items.length<100) break;
    }
    return out;
  }
  async function sync(manual){
    const user=state.cfg.user;
    if(!user){if(manual)setStatus('Escribe tu usuario de GitHub primero.',true);return;}
    if(syncing)return;syncing=true;$('syncBtn').disabled=true;setStatus('Consultando repositorios y verificando PRs…');state.errors={};
    try{
      const detail=[],newRepos={};
      for(const label of names){
        const repo=REPOS[label], base='repo:'+OWNER+'/'+repo;
        try{
          const [closed,open,openPrs,mergedPrs]=await Promise.all([
            fetchAll(base+' is:issue is:closed assignee:'+user),
            fetchAll(base+' is:issue is:open assignee:'+user),
            fetchAll(base+' is:pr is:open author:'+user),
            fetchAll(base+' is:pr is:merged')
          ]);
          const linked=new Map();
          for(const pr of mergedPrs){
            const refs=closingRefs((pr.title||'')+'\n'+(pr.body||''));
            for(const number of refs) linked.set(number,pr);
          }
          const doneItems=closed.filter(issue=>linked.has(issue.number));
          const doneNumbers=new Set(doneItems.map(x=>x.number));
          newRepos[label]={done:doneItems.length,assigned:open.length,review:openPrs.length,merged:mergedPrs.filter(pr=>pr.user?.login?.toLowerCase()===user.toLowerCase()).length};
          for(const issue of doneItems){
            const pr=linked.get(issue.number);
            detail.push({number:issue.number,title:issue.title,url:issue.html_url,repo:label,status:'done',statusLabel:'Resuelto',prUrl:pr.html_url});
          }
          for(const issue of closed.filter(x=>!doneNumbers.has(x.number))){
            detail.push({number:issue.number,title:issue.title,url:issue.html_url,repo:label,status:'closed-unverified',statusLabel:'Cerrado · PR no verificado',prUrl:''});
          }
          for(const issue of open){
            detail.push({number:issue.number,title:issue.title,url:issue.html_url,repo:label,status:'pending',statusLabel:'Pendiente',prUrl:''});
          }
          for(const pr of openPrs){
            detail.push({number:pr.number,title:pr.title,url:pr.html_url,repo:label,status:'review',statusLabel:'PR abierto/en revisión',prUrl:''});
          }
        }catch(e){
          newRepos[label]=state.repos[label]||{done:0,assigned:0,review:0,merged:0};
          state.errors[label]=e.message;
        }
      }
      state.repos={...state.repos,...newRepos};state.detail=detail;state.syncedAt=Date.now();persist();render();
      const errors=Object.keys(state.errors).length;
      setStatus(errors?'Sincronizado con '+errors+' repositorio(s) con error. Revisa el detalle.':'✓ Sincronización completada',!!errors);
      if(manual&&!errors)toast('Datos actualizados correctamente.');
    }catch(e){setStatus(e.message,true);}
    finally{syncing=false;$('syncBtn').disabled=false;}
  }
  $('saveBtn').addEventListener('click',()=>{
    state.cfg={user:$('user').value.trim().replace(/^@/,''),token:$('token').value.trim()};
    persist();sync(true);
  });
  $('syncBtn').addEventListener('click',()=>sync(true));
  $('exportBtn').addEventListener('click',()=>{
    const {token,...cfg}=state.cfg;
    const blob=new Blob([JSON.stringify({...state,cfg,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cont-issues-backup.json';a.click();URL.revokeObjectURL(url);toast('Copia exportada sin token.');
  });
  $('resetBtn').addEventListener('click',()=>{
    if(confirm('¿Borrar contadores y configuración guardada?')){state=fresh();persist();render();setStatus('');toast('Datos reiniciados.');}
  });
  $('filterText').addEventListener('input',renderDetail);
  $('filterStatus').addEventListener('change',renderDetail);
  renderRepos();render();if(!state.syncedAt||Date.now()-state.syncedAt>60000)sync(false);
  setInterval(()=>sync(false),5*60*1000);
})();