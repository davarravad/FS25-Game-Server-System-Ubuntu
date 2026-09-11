function charts(points,latest){
  const container=$('charts');if(!container)return;
  for(const[key,label,format]of metrics){
    let card=container.querySelector('[data-metric="'+key+'"]');
    if(!card){
      card=element('article',undefined,'card resource-chart');card.dataset.metric=key;
      const value=element('div',undefined,'chart-current'),svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.classList.add('chart');svg.setAttribute('viewBox','0 0 600 135');svg.setAttribute('role','img');svg.setAttribute('aria-label',label+' history');
      for(const y of [10,65,125]){const line=document.createElementNS(svg.namespaceURI,'line');for(const[k,v]of Object.entries({x1:0,x2:600,y1:y,y2:y}))line.setAttribute(k,v);svg.append(line);}
      const path=document.createElementNS(svg.namespaceURI,'polyline');svg.append(path);
      card.append(element('h3',label),value,svg,element('p',undefined,'muted chart-summary'));container.append(card);
    }
    const current=card.querySelector('.chart-current'),signature=JSON.stringify([latest?.[key],latest?.memory_limit_bytes,latest?.disk_limit_bytes]);
    if(current.dataset.signature!==signature){
      current.dataset.signature=signature;
      if(key==='memory_used_bytes'||key==='disk_used_bytes'){
        const next=capacity(latest,key==='memory_used_bytes'?'memory':'disk',key==='memory_used_bytes'?'RAM':'Disk'),old=current.firstElementChild;
        if(old){
          old.querySelector('.capacity-value').textContent=next.querySelector('.capacity-value').textContent;
          old.querySelector('p').textContent=next.querySelector('p').textContent;
          const meter=old.querySelector('progress'),updated=next.querySelector('progress');
          if(meter&&updated){meter.max=updated.max;meter.value=updated.value;meter.className=updated.className;}
          else if(meter)meter.remove();else if(updated)old.insertBefore(updated,old.querySelector('p'));
        }else current.append(next);
      }
      else{if(!current.firstChild)current.append(element('div',undefined,'value'));current.firstChild.textContent=format(latest?.[key]);}
    }
    const values=points.filter(p=>Number.isFinite(p[key])),svg=card.querySelector('svg'),path=svg.querySelector('polyline'),summary=card.querySelector('.chart-summary');
    if(!values.length){path.setAttribute('points','');summary.textContent='No samples yet. Waiting for node telemetry.';continue;}
    const high=Math.max(...values.map(p=>p[key])),max=Math.max(1,high),start=Date.now()/1000-hours*3600;
    const target=values.map(p=>[Math.max(0,Math.min(600,(p.timestamp-start)/(hours*3600)*600)),125-p[key]/max*110]);
    summary.textContent=`Min ${format(Math.min(...values.map(p=>p[key])))} · Max ${format(high)} · Avg ${format(values.reduce((a,p)=>a+p[key],0)/values.length)}`;
    const previous=path._points;cancelAnimationFrame(path._animation);
    const paint=coords=>{path._points=coords;path.setAttribute('points',coords.map(p=>p.join(',')).join(' '));};
    if(!previous||!previous.length||matchMedia('(prefers-reduced-motion: reduce)').matches){paint(target);continue;}
    const origin=target.map((_,i)=>previous[Math.round(i*(previous.length-1)/Math.max(1,target.length-1))]);
    const began=performance.now();
    const animate=now=>{if(!path.isConnected)return;const t=Math.min(1,(now-began)/650),ease=1-(1-t)**3;paint(target.map((p,i)=>p.map((v,j)=>origin[i][j]+(v-origin[i][j])*ease)));if(t<1)path._animation=requestAnimationFrame(animate);};
    path._animation=requestAnimationFrame(animate);
  }
}
