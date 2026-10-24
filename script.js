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
  async function api(path){
    const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
    if(state.cfg.token)headers.Authorization='Bearer '+state.cfg.token;
    const r=await fetch('https://api.github.com'+path,{headers});
    if(r.status===403||r.status===429){
      const resource=r.headers.get('x-ratelimit-resource')||'API';
      const reset=r.headers.get('x-ratelimit-reset');
      const when=reset?new Date(Number(reset)*1000).toLocaleTimeString():'más tarde';
      throw new Error('Límite de GitHub ('+resource+'). Intenta después de las '+when+'. Para repos públicos, no necesitas token.');
    }
    if(r.status===401)throw new Error('Token inválido o caducado. Corrígelo o déjalo vacío si solo consultas repos públicos.');
    if(r.status===404)throw new Error('No se encontró el repositorio o no tienes acceso.');
    if(!r.ok)throw new Error('GitHub respondió con error '+r.status+'.');
    return r.json();
  }
  const repoApi=(repo,path)=>api('/repos/'+OWNER+'/'+repo+path);
  function renderRepos(){
    $('repos').innerHTML=names.map((n,i)=>'<article class="repo"><div class="repo-top"><h3>'+esc(n)+'</h3><div class="repo-icon">'+String(i+1).padStart(2,'0')+'</div></div><div class="count" id="count-'+i+'">0</div><small id="msg-'+i+'">Issues verificados</small><div class="repo-mini" id="mini-'+i+'"></div></article>').join('');
  }
  function render(){
    names.forEach((n,i)=>{const r=state.repos[n]||{done:0,assigned:0,review:0,merged:0};$('count-'+i).textContent=r.done||0;$('msg-'+i).textContent=state.errors[n]||'Issues verificados con PR fusionado';$('msg-'+i).className=state.errors[n]?'err':'';$('mini-'+i).textContent=(r.assigned||0)+' pendientes · '+(r.review||0)+' PR abiertos';});
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
  function closingRefs(text,prRepo){
    const refs=new Set(),re=/(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+(?:([\w.-]+)\/([\w.-]+))?#(\d+)/gi;let m;
    while((m=re.exec(text||''))!==null){if(!m[2]||norm(m[2])===norm(prRepo))refs.add(Number(m[3]));}
    return refs;
  }
  async function sync(manual){
    const user=state.cfg.user;if(!user){if(manual)setStatus('Escribe tu usuario de GitHub primero.',true);return;}
    if(syncing)return;syncing=true;$('syncBtn').disabled=true;setStatus('Consultando repositorios (API estándar de GitHub)…');state.errors={};
    try{
      const newRepos={},detail=[];
      for(const label of names){
        const repo=REPOS[label];
        try{
          // Usa la API estándar de repositorios, no el endpoint de búsqueda que tiene un límite mucho menor.
          const [issues,closedPrs,openPrs]=await Promise.all([
            repoApi(repo,'/issues?state=all&assignee='+encodeURIComponent(user)+'&per_page=100'),
            repoApi(repo,'/pulls?state=closed&per_page=100&sort=updated&direction=desc'),
            repoApi(repo,'/pulls?state=open&per_page=100&sort=updated&direction=desc')
          ]);
          const mergedPrs=closedPrs.filter(pr=>pr.merged_at);
          const links=new Map();
          for(const pr of mergedPrs){
            for(const num of closingRefs((pr.title||'')+'\n'+(pr.body||''),repo))links.set(num,pr);
          }
          const assignedIssues=issues.filter(x=>!x.pull_request);
          const closed=assignedIssues.filter(x=>x.state==='closed'),open=assignedIssues.filter(x=>x.state==='open');
          const done=closed.filter(issue=>links.has(issue.number)),doneSet=new Set(done.map(x=>x.number));
          const myOpenPrs=openPrs.filter(pr=>pr.user?.login?.toLowerCase()===user.toLowerCase());
          const myMergedPrs=mergedPrs.filter(pr=>pr.user?.login?.toLowerCase()===user.toLowerCase());
          newRepos[label]={done:done.length,assigned:open.length,review:myOpenPrs.length,merged:myMergedPrs.length};
          for(const issue of done){const pr=links.get(issue.number);detail.push({number:issue.number,title:issue.title,url:issue.html_url,repo:label,status:'done',statusLabel:'Resuelto verificado',prUrl:pr.html_url});}
          for(const issue of closed.filter(x=>!doneSet.has(x.number)))detail.push({number:issue.number,title:issue.title,url:issue.html_url,repo:label,status:'closed-unverified',statusLabel:'Cerrado · PR no verificado',prUrl:''});
          for(const issue of open)detail.push({number:issue.number,title:issue.title,url:issue.html_url,repo:label,status:'pending',statusLabel:'Pendiente',prUrl:''});
          for(const pr of myOpenPrs)detail.push({number:pr.number,title:pr.title,url:pr.html_url,repo:label,status:'review',statusLabel:'PR abierto/en revisión',prUrl:''});
        }catch(e){
          state.errors[label]=e.message;
          newRepos[label]=state.repos[label]||{done:0,assigned:0,review:0,merged:0};
        }
      }
      state.repos={...state.repos,...newRepos};state.detail=detail;state.syncedAt=Date.now();persist();render();
      const errs=Object.keys(state.errors).length;
      setStatus(errs?'Sincronización parcial: '+errs+' repositorio(s) con error. Revisa los mensajes.':'✓ Sincronización completada',!!errs);
      if(manual&&!errs)toast('Datos actualizados correctamente.');
    }catch(e){setStatus(e.message,true);}
    finally{syncing=false;$('syncBtn').disabled=false;}
  }
  $('saveBtn').addEventListener('click',()=>{state.cfg={user:$('user').value.trim().replace(/^@/,''),token:$('token').value.trim()};persist();sync(true);});
  $('syncBtn').addEventListener('click',()=>sync(true));
  $('exportBtn').addEventListener('click',()=>{const {token,...cfg}=state.cfg;const blob=new Blob([JSON.stringify({...state,cfg,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='cont-issues-backup.json';a.click();URL.revokeObjectURL(url);toast('Copia exportada sin token.');});
  $('resetBtn').addEventListener('click',()=>{if(confirm('¿Borrar contadores y configuración guardada?')){state=fresh();persist();render();setStatus('');toast('Datos reiniciados.');}});
  $('filterText').addEventListener('input',renderDetail);$('filterStatus').addEventListener('change',renderDetail);
  renderRepos();render();if(!state.syncedAt||Date.now()-state.syncedAt>30*60*1000)sync(false);
  setInterval(()=>sync(false),30*60*1000);
})();