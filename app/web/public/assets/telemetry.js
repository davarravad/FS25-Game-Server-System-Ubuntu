(() => {
  'use strict';
  const bytes = n => { if (!Number.isFinite(n)) return '—'; const i = Math.min(4, Math.floor(Math.log(Math.max(1,n))/Math.log(1024))); return `${(n/1024**i).toFixed(i ? 2 : 0)} ${['B','KiB','MiB','GiB','TiB'][i]}`; };
  const definitions = [['cpu_percent','CPU','#60a5fa',n=>`${n.toFixed(1)}%`],['memory_used_bytes','Memory','#2dd4bf',bytes],['disk_used_bytes','Disk','#fbbf24',bytes],['network_in_bytes_sec','Network in','#a78bfa',n=>`${bytes(n)}/s`],['network_out_bytes_sec','Network out','#f472b6',n=>`${bytes(n)}/s`]];
  document.querySelectorAll('.telemetry').forEach(root => {
    const target = root.querySelector('[data-metric-target]'), status = root.querySelector('[role=status]'), grid = root.querySelector('.telemetry-grid');
    let hours = 1, paused = false, controller, timer, data;
    const fmt = (value, format) => Number.isFinite(value) ? format(value) : '—';
    function render() {
      grid.replaceChildren();
      const host = !target.value.includes('instance_id=');
      definitions.forEach(([key,label,color,format]) => {
        const article = document.createElement('article'); article.className='telemetry-chart'; article.style.setProperty('--metric-color',color);
        const header=document.createElement('header'), title=document.createElement('h3'), current=document.createElement('strong');
        title.textContent=label; current.textContent=fmt(data?.latest?.[key],format); header.append(title,current);
        const canvas=document.createElement('canvas'); canvas.setAttribute('role','img'); canvas.setAttribute('aria-label',`${label} history for the last ${hours} hours`);
        const footer=document.createElement('footer'); article.append(header,canvas,footer); grid.append(article);
        const points=data?.points || [], values=points.map(p=>p[key]).filter(Number.isFinite);
        const summary=values.length ? `Min ${format(Math.min(...values))} · Max ${format(Math.max(...values))} · Avg ${format(values.reduce((a,b)=>a+b,0)/values.length)}` : 'No samples yet';
        footer.textContent=summary;
        const width=canvas.clientWidth, height=160, scale=window.devicePixelRatio || 1;
        canvas.width=width*scale; canvas.height=height*scale; const ctx=canvas.getContext('2d'); ctx.scale(scale,scale);
        const left=62,right=width-8,top=12,bottom=134,end=Date.now()/1000,start=end-hours*3600;
        const capacity=key==='memory_used_bytes' ? data?.latest?.memory_limit_bytes : (key==='disk_used_bytes' && host ? data?.latest?.disk_limit_bytes : null);
        const max=Math.max(key==='cpu_percent' ? 100 : 1,capacity||0,...values)*1.08;
        ctx.font='10px system-ui';ctx.lineWidth=1;
        for(let i=0;i<=3;i++){const y=top+(bottom-top)*i/3;ctx.strokeStyle='#27364b';ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.fillStyle='#93a6c0';ctx.fillText(format(max*(1-i/3)),0,y+4);}
        ctx.fillStyle='#93a6c0';ctx.fillText(new Date(start*1000).toLocaleString([], {month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}),left,154);
        ctx.textAlign='right';ctx.fillText('Now',right,154);ctx.textAlign='left';
        if(capacity>0){const y=bottom-capacity/max*(bottom-top);ctx.strokeStyle='#f87171';ctx.setLineDash([5,5]);ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(right,y);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle='#fca5a5';ctx.fillText('Capacity '+format(capacity),left,y-5);}
        ctx.strokeStyle=color;ctx.lineWidth=2;ctx.beginPath();let previous=null;
        for(const point of points){const value=point[key];if(!Number.isFinite(value)){previous=null;continue;}const x=left+(point.timestamp-start)/(end-start)*(right-left), y=bottom-value/max*(bottom-top); if(previous===null || point.timestamp-previous>(data.bucket_seconds||30)*3)ctx.moveTo(x,y);else ctx.lineTo(x,y);previous=point.timestamp;}ctx.stroke();
        if(values.length===1){const p=points.find(p=>Number.isFinite(p[key]));ctx.fillStyle=color;ctx.beginPath();ctx.arc(left+(p.timestamp-start)/(end-start)*(right-left),bottom-p[key]/max*(bottom-top),3,0,Math.PI*2);ctx.fill();}
        canvas.addEventListener('pointermove',event=>{if(!points.length)return;const at=start+(event.offsetX-left)/(right-left)*(end-start);const point=points.reduce((a,b)=>Math.abs(a.timestamp-at)<Math.abs(b.timestamp-at)?a:b);footer.textContent=`${new Date(point.timestamp*1000).toLocaleString()} · ${fmt(point[key],format)}`;});
        canvas.addEventListener('pointerleave',()=>{footer.textContent=summary;});
      });
    }
    async function refresh() {
      clearTimeout(timer); if(paused || document.hidden || !target.value)return;
      controller?.abort(); const active=new AbortController(); controller=active;
      const timeout=setTimeout(()=>active.abort(),15000);
      try {const response=await fetch(`/?route=telemetry&${target.value}&hours=${hours}`,{signal:active.signal,cache:'no-store'});if(!response.ok)throw Error('Metrics unavailable');const payload=await response.json();if(controller!==active)return;if(!payload.ok)throw Error(payload.error||'Metrics unavailable');data=payload;render();status.textContent=payload.sampled_at ? `${Date.now()/1000-payload.sampled_at>90?'Stale data · ':'Live · '}Last sample ${new Date(payload.sampled_at*1000).toLocaleString()}` : 'No history yet. Samples will appear after the agent starts collecting.';}
      catch(error){if(controller===active && !paused && !document.hidden)status.textContent='Unable to refresh metrics. Retrying in 30 seconds; any displayed values are from the last successful refresh.';}
      finally{clearTimeout(timeout);if(controller===active)timer=setTimeout(refresh,30000);}
    }
    target.addEventListener('change',()=>{data=null;render();refresh();});
    root.querySelectorAll('[data-hours]').forEach(button=>button.addEventListener('click',()=>{hours=Number(button.dataset.hours);root.querySelectorAll('[data-hours]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));refresh();}));
    root.querySelector('[data-metric-pause]').addEventListener('click',event=>{paused=!paused;event.target.textContent=paused?'Resume live':'Pause live';if(paused){controller?.abort();clearTimeout(timer);status.textContent='Live updates paused';}else refresh();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){controller?.abort();clearTimeout(timer);}else refresh();});
    let resize;window.addEventListener('resize',()=>{clearTimeout(resize);resize=setTimeout(render,150);});
    render();refresh();
  });
  const search=document.querySelector('[data-server-search]');
  search?.addEventListener('input',()=>{let count=0;document.querySelectorAll('[data-live-instance-id]').forEach(card=>{card.hidden=!card.textContent.toLowerCase().includes(search.value.toLowerCase());if(!card.hidden)count++;});document.querySelector('[data-server-count]').textContent=`${count} servers`;});
})();


