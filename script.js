(() => {
  const KEY = 'chuspa_issue_tracker_v2';
  const OWNER = 'sis-inf'; // dueño/organización de los repos
  // Nombre mostrado -> nombre real del repo en GitHub (sin el dueño)
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
    cfg:{user:'',owner:'sis-inf',mode:'author',token:''},
    repos:Object.fromEntries(names.map(n=>[n,0])),
    errors:{}, assigned:0, review:0, syncedAt:null, detail:[], merged:0
  });
  let state = load(), syncing = false;

  function load(){
    try{
      const s = JSON.parse(localStorage.getItem(KEY)||'null'); const d = fresh();
      if(!s) return d;
      return {...d, ...s, cfg:{...d.cfg,...s.cfg}, repos:{...d.repos,...s.repos}, errors:{}};
    }catch(e){return fresh();}
  }
  function persist(){ try{localStorage.setItem(KEY,JSON.stringify(state));}catch(e){} }
  const total = () => names.reduce((a,n)=>a+(state.repos[n]||0),0);

  function toast(m){const el=$('toast');el.textContent=m;el.style.display='block';clearTimeout(toast.t);toast.t=setTimeout(()=>el.style.display='none',2600);}
  function setStatus(m,bad){const el=$('status');el.textContent=m;el.className='status'+(bad?' bad':'');}

  function renderRepos(){
    $('repos').innerHTML = names.map((n,i)=>`
      <article class="repo"><div class="repo-top"><h3>${n}</h3><div class="repo-icon">${String(i+1).padStart(2,'0')}</div></div>
      <div class="count" id="count-${i}">0</div><small id="msg-${i}"></small></article>`).join('');
  }
  function render(){
    names.forEach((n,i)=>{
      $('count-'+i).textContent = state.repos[n]||0;
      const m=$('msg-'+i), e=state.errors[n];
      m.textContent = e || 'Issues contados en este repositorio'; m.className = e?'err':'';
    });
    const t=total(), left=Math.max(0,40-t), pct=Math.round(t/40*100);
    $('total').textContent=t; $('remaining').textContent=left;
    $('goalHint').textContent = t>=40 ? (t===40?'¡Mínimo alcanzado!':'Mínimo superado por '+(t-40)) : 'Issues para alcanzar el mínimo';
    $('percent').textContent=pct+'%'; $('progress').style.width=Math.min(100,pct)+'%';
    $('assigned').textContent=state.assigned; $('review').textContent=state.review; renderDetail();
    $('syncedAt').textContent = state.syncedAt ? 'Sincronizado: '+new Date(state.syncedAt).toLocaleTimeString() : 'Sin sincronizar';
    $('user').value=state.cfg.user; $('token').value=state.cfg.token;
  }

  const norm = x => String(x).toLowerCase().replace(/[^a-z0-9]/g,'');
  const esc = x => String(x).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  async function api(path){
    const headers={'Accept':'application/vnd.github+json'};
    if(state.cfg.token) headers['Authorization']='Bearer '+state.cfg.token;
    const r = await fetch('https://api.github.com'+path,{headers});
    if(r.status===403||r.status===429) throw new Error('Límite de consultas de GitHub alcanzado; espera 1 min o agrega un token.');
    if(r.status===401) throw new Error('Token inválido.');
    if(r.status===404){const e=new Error('No encontrado (si los repos son privados, agrega un token).');e.notFound=true;throw e;}
    if(r.status===422) throw new Error('GitHub rechazó la consulta (usuario o repos no válidos).');
    if(!r.ok) throw new Error('Error de GitHub ('+r.status+').');
    return r.json();
  }
  const search = (q,per,page=1) => api('/search/issues?per_page='+per+'&page='+page+'&q='+encodeURIComponent(q));

  // Lista real de repos del dueño
  async function listRepos(){
    const out=[];
    for(let page=1;page<=3;page++){
      let chunk;
      try{ chunk = await api(`/orgs/${OWNER}/repos?per_page=100&type=all&page=${page}`); }
      catch(e){ if(e.notFound) chunk = await api(`/users/${OWNER}/repos?per_page=100&page=${page}`); else throw e; }
      out.push(...chunk); if(chunk.length<100) break;
    }
    return out;
  }

  // Hechos
  const doneFilter = user => `assignee:${user} is:closed`;

  function renderDetail(){
    const d=$('detail');
    if(!state.syncedAt){d.innerHTML='';return;}
    d.innerHTML = `<summary>Ver los ${state.detail.length} issues contados</summary><ul>`+
      state.detail.map(i=>`<li><a href="${esc(i.u)}" target="_blank" rel="noopener">${esc(i.repo)}#${i.n}</a> — ${esc(i.t)}</li>`).join('')+
      `</ul><div class="m">PRs fusionados creados por ti: ${state.merged} (no se suman al total). Si tu conteo manual es mayor, compara esta lista con tu tablero.</div>`;
  }

  async function sync(manual){
    const {user} = state.cfg;
    if(!user){ if(manual) setStatus('Escribe tu usuario de GitHub primero.',true); return; }
    if(syncing) return; syncing=true; $('syncBtn').disabled=true; setStatus('Sincronizando…');
    state.errors={};
    try{
      const list = await listRepos();
      const byNorm = Object.fromEntries(list.map(r=>[norm(r.name),r.name]));
      const resolved = {};
      names.forEach(n=>{
        const real = byNorm[norm(REPOS[n])] || byNorm[norm(n)];
        if(real) resolved[n]=real;
        else state.errors[n] = `No existe en ${OWNER}. Repos: `+list.slice(0,10).map(r=>r.name).join(', ');
      });
      const found = Object.keys(resolved);
      if(!found.length) throw new Error(`No encontré ninguno de los repos en ${OWNER}.`);
      const allRepos = found.map(n=>`repo:${OWNER}/${resolved[n]}`).join(' ');

      const counts = Object.fromEntries(names.map(n=>[n,0]));
      const detail = []; let total=0;
      for(let page=1;page<=5;page++){
        const data = await search(`${allRepos} is:issue ${doneFilter(user)}`,100,page);
        total = data.total_count;
        for(const it of data.items){
          const repo = it.repository_url.split('/').pop();
          const n = found.find(x=>norm(resolved[x])===norm(repo));
          if(n){ counts[n]++; detail.push({n:it.number,t:it.title,u:it.html_url,repo}); }
        }
        if(page*100>=total) break;
      }
      state.repos = counts; state.detail = detail;
      try{ state.assigned = (await search(`${allRepos} is:issue is:open assignee:${user}`,1)).total_count; }catch(e){}
      try{ state.review   = (await search(`${allRepos} is:pr is:open author:${user}`,1)).total_count; }catch(e){}
      try{ state.merged   = (await search(`${allRepos} is:pr is:merged author:${user}`,1)).total_count; }catch(e){}
      state.syncedAt = Date.now(); persist(); render();
      const miss = names.length-found.length;
      setStatus(miss? `Sincronizado, pero ${miss} repo(s) no se encontraron.` : '✓ Sincronizado con GitHub', !!miss);
    }catch(e){
      names.forEach(n=>{ if(!state.errors[n]) state.errors[n]=e.message; }); render(); setStatus(e.message,true);
    } finally { syncing=false; $('syncBtn').disabled=false; }
  }

  $('saveBtn').addEventListener('click',()=>{
    state.cfg = {user:$('user').value.trim().replace(/^@/,''), token:$('token').value.trim()};
    persist(); sync(true);
  });
  $('syncBtn').addEventListener('click',()=>sync(true));
  $('exportBtn').addEventListener('click',()=>{
    const {token,...cfg}=state.cfg;
    const blob=new Blob([JSON.stringify({...state,cfg,exportedAt:new Date().toISOString()},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='chuspa-issues-backup.json';a.click();URL.revokeObjectURL(url);toast('Copia exportada (sin token).');
  });
  $('resetBtn').addEventListener('click',()=>{
    if(confirm('¿Borrar contadores y configuración guardada?')){state=fresh();persist();render();setStatus('');toast('Datos reiniciados.');}
  });

  renderRepos(); render(); if(!state.syncedAt||Date.now()-state.syncedAt>60000) sync(false);
  setInterval(()=>sync(false), 5*60*1000);
})();