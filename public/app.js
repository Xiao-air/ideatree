import { STATES, KINDS, PALETTE, today, dateValue, id, orderedEvents, statusAt, ideaEndDate, treeRows, descendants, validateDocument } from './model.mjs';
import { familySides, fitVertical, packLanes } from './layout.mjs';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const icons = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true' } });
const shortDate = s => `${Number(s.slice(5,7))}月${Number(s.slice(8,10))}日`;
const fullDate = s => `${s.slice(0,4)} 年 ${Number(s.slice(5,7))} 月 ${Number(s.slice(8,10))} 日`;
const symbols = { pending:'○', active:'↗', paused:'Ⅱ', split:'⑂', stopped:'×', completed:'✓' };
let doc, revision = 0, selected = null, selectedEvent = null, collapsed = new Set(), formMode = null;
let saveQueue = Promise.resolve(), pendingSaves = 0, saveBlocked = false, toastTimer;
let chartWidth = 900, transform = d3.zoomIdentity, baseScale, rows = [], detailOpen = innerWidth > 1000;
let chartLayout;
let archiveOpen = false;
const MAIN_AXIS_COLOR = '#3264d6';
const textMeasure = document.createElement('canvas').getContext('2d');
let chartFont;
const svg = d3.select('#timeline');
const zoom = d3.zoom().scaleExtent([0.35, 12]).filter(e => e.type !== 'dblclick' && (e.type !== 'wheel' || (e.shiftKey && !e.ctrlKey && !e.metaKey)) && !e.button && (e.type === 'wheel' || !e.target.closest('.chart-button'))).wheelDelta(e => -(e.deltaY || e.deltaX)*(e.deltaMode === 1 ? .05 : e.deltaMode ? 1 : .002)).on('zoom', e => { transform = e.transform; drawChart(); });
zoom.on('end',()=>{if(doc){setupScale();drawChart();}});
svg.call(zoom).on('dblclick.zoom', null);
const duration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220;
function notify(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function selectedIdea() { return doc?.ideas.find(i => i.id === selected); }
function badge(state, clickable = false) {
  const s = STATES[state];
  return `<${clickable ? 'button data-action="status" aria-label="更改 idea 状态"' : 'span'} class="state-badge" style="--state-color:${s.color};--state-bg:${s.color}12">${symbols[state]} ${s.label}${clickable ? icon('chevron-down') : ''}</${clickable ? 'button' : 'span'}>`;
}
function saveState(message, error = false) { $('#save-state').classList.toggle('error',error); $('#save-state').innerHTML = `<span class="save-dot"></span><span>${escape(message)}</span>`; }
async function commit(next, message = '已保存') {
  const clean = validateDocument(next);
  if (saveBlocked) throw new Error('保存尚未恢复。请先导出当前备份，再刷新页面。');
  doc = clean; render(); pendingSaves++; saveState('正在保存…');
  const snapshot = structuredClone(clean);
  const task = saveQueue.then(async () => {
    if (saveBlocked) throw new Error('保存已暂停，请导出备份后刷新。');
    const response = await fetch('/api/data', { method:'PUT', headers:{'Content-Type':'application/json'}, body:JSON.stringify({...snapshot,revision}) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || '保存失败');
    revision = result.revision;
  });
  saveQueue = task.catch(error => { saveBlocked = true; saveState(error.message,true); });
  try { await task; notify(message); }
  catch (error) { notify(error.message); throw error; }
  finally { pendingSaves--; if (!pendingSaves && !saveBlocked) saveState(`已保存在本机 · ${new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}`); }
}
function render() {
  $('#space-name').textContent = doc.name; $('#idea-count').textContent = doc.ideas.length;
  $('#demo-badge').hidden = !doc.demo; $('#demo-notice').hidden = !doc.demo;
  if (!doc.ideas.some(i => i.id === selected)) selected = doc.ideas[0]?.id ?? null;
  rows = treeRows(doc.ideas,collapsed);
  renderNavigation();
  $('#legend').innerHTML = Object.entries(STATES).map(([key,state]) => `<span class="legend-item"><span class="legend-mark" style="color:${state.color}">${symbols[key]}</span>${state.label}</span>`).join('');
  renderDetail(); setupScale(); drawChart(); icons();
}
function renderNavigation() {
  const states = new Map(doc.ideas.map(idea => [idea.id,statusAt(idea)]));
  function group(state) {
    const members = doc.ideas.filter(idea => states.get(idea.id) === state).sort((a,b) => a.created.localeCompare(b.created));
    function visit(parentId,depth) {
      return members.filter(idea => (states.get(idea.parentId) === state ? idea.parentId : null) === parentId).map(idea => {
        const hasChildren = doc.ideas.some(child => child.parentId === idea.id);
        const source = depth === 0 && doc.ideas.find(parent => parent.id === idea.parentId);
        const row = `<div class="idea-nav ${selected === idea.id ? 'selected' : ''} ${depth ? 'child' : ''}" style="margin-left:${Math.min(depth,4)*9}px;padding-left:${depth?10:0}px"><button class="idea-select" data-select="${escape(idea.id)}" aria-pressed="${selected === idea.id}" title="${escape(idea.name)}${source?` · 源于 ${escape(source.name)}`:''}"><span class="branch-dot" style="background:${idea.color}"></span><span class="nav-label"><span class="name">${escape(idea.name)}</span>${source?`<span class="nav-source">源于 ${escape(source.name)}</span>`:''}</span></button>${hasChildren ? `<button class="collapse" data-collapse="${escape(idea.id)}" aria-label="${collapsed.has(idea.id)?'展开':'折叠'} ${escape(idea.name)} 的分支" aria-expanded="${!collapsed.has(idea.id)}">${icon(collapsed.has(idea.id)?'chevron-right':'chevron-down')}</button>`:''}</div>`;
        return row + (collapsed.has(idea.id) ? '' : visit(idea.id,depth+1));
      }).join('');
    }
    return `<div class="idea-nav-group" data-state="${state}">${visit(null,0)}</div>`;
  }
  const archived = doc.ideas.filter(idea => states.get(idea.id) === 'stopped').length;
  const splitCount = doc.ideas.filter(idea => states.get(idea.id) === 'split').length;
  $('#idea-list').innerHTML = doc.ideas.length ? `<div class="ongoing-ideas">${['active','pending','paused','completed'].map(group).join('')}</div>${splitCount?`<section class="split-directions" aria-label="已拆分方向"><div class="split-heading" title="原方向不再独立推进，由子方向承接">${icon('git-fork')}<span>已拆分</span><span class="split-count">${splitCount}</span></div>${group('split')}</section>`:''}${archived?`<section class="archive-folder"><button class="archive-toggle ${states.get(selected)==='stopped'?'contains-selected':''}" data-action="toggle-archive" aria-expanded="${archiveOpen}" aria-controls="archived-ideas">${icon(archiveOpen?'folder-open':'folder')}<span>已归档</span><span class="archive-count">${archived}</span>${icon(archiveOpen?'chevron-down':'chevron-right')}</button><div id="archived-ideas" ${archiveOpen?'':'hidden'}>${group('stopped')}</div></section>`:''}` : '<p class="sidebar-empty">还没有 idea，先记录一个想法。</p>';
}
function selectIdea(ideaId, eventId = null) {
  selected = ideaId; selectedEvent = eventId; detailOpen = true;
  let idea = selectedIdea();
  if (statusAt(idea) === 'stopped') archiveOpen = true;
  while (idea?.parentId) { collapsed.delete(idea.parentId); idea = doc.ideas.find(parent => parent.id === idea.parentId); }
  setSidebar(false); render();
  if (eventId) requestAnimationFrame(() => document.getElementById(`history-${eventId}`)?.scrollIntoView({block:'nearest',behavior:'smooth'}));
}
function renderDetail() {
  const panel = $('#detail-panel'); panel.classList.toggle('closed',!detailOpen); $('#toggle-detail').setAttribute('aria-expanded',detailOpen);
  const idea = selectedIdea();
  if (!idea) { panel.innerHTML = `<div class="detail-placeholder">${icon('mouse-pointer-2')}<p>选择一个 idea<br>查看它的经历与下一步。</p></div>`; return; }
  const status = statusAt(idea); const parent = doc.ideas.find(i => i.id === idea.parentId);
  const events = orderedEvents(idea).reverse(); const next = events.find(e => e.next)?.next;
  panel.innerHTML = `<div class="detail-top"><span class="eyebrow">IDEA / ${String(doc.ideas.indexOf(idea)+1).padStart(2,'0')}</span><div><button class="icon-btn" data-action="edit-idea" aria-label="编辑 idea">${icon('pencil')}</button><button class="icon-btn" data-action="close-detail" aria-label="关闭详情">${icon('x')}</button></div></div>
    <div class="detail-intro">${badge(status,true)}<h2>${escape(idea.name)}</h2><p class="detail-summary">${escape(idea.summary || '还没有补充核心问题。')}</p>
    <dl class="idea-meta"><dt>首次提出</dt><dd>${fullDate(idea.created)}</dd><dt>想法来源</dt><dd>${parent?`<button class="parent-link" data-select="${escape(parent.id)}">↳ ${escape(parent.name)}</button>`:'独立提出'}</dd>${status==='split'?'<dt>方向去向</dt><dd>由子方向承接</dd>':''}</dl>
    <div class="detail-buttons"><button class="btn primary" data-action="add-event">${icon('plus')}记录事件</button><button class="btn" data-action="branch">${icon('git-branch')}衍生 idea</button></div>
    ${next?`<div class="next-step"><strong>${icon('corner-down-right')}下一步 / 恢复条件</strong><p>${escape(next)}</p></div>`:''}</div>
    <section class="history"><div class="history-heading"><h3>发展记录</h3><span>${events.length + 1} 个节点</span></div>
    ${events.map(event => `<article id="history-${escape(event.id)}" class="history-item ${event.status?'is-status':''} ${selectedEvent === event.id?'event-selected':''}" style="--state-color:${STATES[event.status]?.color || '#75858e'}"><div class="event-meta"><time datetime="${event.date}">${event.date.replaceAll('-','.')}</time><span class="event-type">${escape(event.kind)}</span></div><h3>${escape(event.title)}</h3>${event.note?`<p>${escape(event.note)}</p>`:''}${event.status?`<div class="event-decision">${symbols[event.status]} 决定${STATES[event.status].label}</div>`:''}${event.next?`<p>下一步：${escape(event.next)}</p>`:''}${event.link?`<a class="event-link" href="${escape(event.link)}" target="_blank" rel="noopener noreferrer">${icon('external-link')}查看参考资料</a>`:''}<div class="event-tools"><button data-action="edit-event" data-event="${escape(event.id)}">${icon('pencil')}编辑</button><button data-action="branch" data-event="${escape(event.id)}">${icon('git-branch')}从此衍生</button><button data-action="delete-event" data-event="${escape(event.id)}" aria-label="删除事件 ${escape(event.title)}">${icon('trash-2')}删除</button></div></article>`).join('')}
    <article class="history-item"><div class="event-meta"><time datetime="${idea.created}">${idea.created.replaceAll('-','.')}</time><span>起点</span></div><h3>${parent?'从原想法衍生':'第一次提出这个想法'}</h3><p>初始状态 · ${STATES[idea.initialStatus].label}</p></article></section>
    <div class="detail-bottom"><button data-action="delete-idea">${icon('trash-2')}删除这个 idea</button></div>`;
}
function measureText(value,size=14,weight=600) {
  textMeasure.font=`${weight} ${size}px ${chartFont}`;
  return textMeasure.measureText(value).width;
}
function branchGeometry(idea,x,turnWidth=18,clip=true) {
  const start=x(dateValue(idea.created)),ordered=orderedEvents(idea);
  const endDate=ideaEndDate(idea);
  const end=x(dateValue(endDate)),bend=Math.min(turnWidth,Math.max(0,end-start));
  const titleStart=start+Math.min(bend,8)+6,titleX=clip?Math.max(24,titleStart):titleStart;
  let title=idea.name;
  if(clip)while(title.length>1&&measureText(title)>chartWidth-titleX-15)title=title.replace(/…$/,'').slice(0,-1)+'…';
  const titleWidth=measureText(title),labels=new Map();
  let left=Math.min(start-10,titleX-3),right=Math.max(end+64,titleX+titleWidth+3),lastLabelEnd=-Infinity;
  for(const [date,events] of d3.group(ordered,event=>event.date)) {
    const event=events.at(-1),ex=x(dateValue(date));
    left=Math.min(left,ex-15);right=Math.max(right,ex+15);
    if(clip&&(ex < -20 || ex > chartWidth+20))continue;
    const label=events.length>1?`${events.length} 条发展记录`:(event.title.length>8?event.title.slice(0,8)+'…':event.title);
    const width=measureText(label,12,400),labelX=clip?Math.max(10,Math.min(ex-width/2,chartWidth-width-12)):ex-width/2;
    left=Math.min(left,labelX);right=Math.max(right,labelX+width);
    if(labelX>lastLabelEnd+12) {labels.set(date,{text:label,x:labelX});lastLabelEnd=labelX+width;}
  }
  const foldLabel=collapsed.has(idea.id)?`另有 ${descendants(doc.ideas,idea.id).size-1} 个分支已折叠`:'';
  if(foldLabel)right=Math.max(right,titleX+measureText(foldLabel,12,400));
  return {left,right,title,titleX,titleWidth,labels,foldLabel};
}
function layoutBranches() {
  const children = new Map(), order = new Map(doc.ideas.map((idea,index)=>[idea.id,index]));
  for(const idea of doc.ideas) {
    if(!children.has(idea.parentId))children.set(idea.parentId,[]);
    children.get(idea.parentId).push(idea);
  }
  // Newer siblings sit nearer their source; older branches turn before them.
  for(const siblings of children.values())siblings.sort((a,b)=>b.created.localeCompare(a.created)||order.get(b.id)-order.get(a.id));
  const roots=children.get(null)||[],sides=familySides(doc.ideas),entries=[];
  function visit(idea) {
    const side=sides.get(idea.id);
    // Measure un-clipped content in scaled time coordinates; panning does not reorder lanes.
    const x=date=>baseScale(date)*transform.k,geometry=branchGeometry(idea,x,18,false);
    if(!collapsed.has(idea.id))for(const child of children.get(idea.id)||[])geometry.right=Math.max(geometry.right,x(dateValue(child.created))+10);
    entries.push({id:idea.id,parentId:idea.parentId,side,start:x(dateValue(idea.created)),left:geometry.left,right:geometry.right});
    if(!collapsed.has(idea.id))for(const child of children.get(idea.id)||[])visit(child);
  }
  for(const root of roots)visit(root);
  const {positions,depths}=packLanes(entries);
  const available=$('#chart-scroll').clientHeight,minimum=rows.some(({idea})=>collapsed.has(idea.id))?80:64;
  const {height,gap,axisY}=fitVertical(depths,available,minimum),yMap=new Map(),turnWidths=new Map();
  for(const [id,position] of positions) {
    yMap.set(id,axisY+(position.side===0?-1:1)*position.lane*gap);
    turnWidths.set(id,position.turnWidth);
  }
  return {axisY,yMap,turnWidths,gap,height};
}
function setupScale() {
  chartWidth = $('#chart-scroll').clientWidth || 900;
  chartFont=getComputedStyle(document.body).fontFamily;
  const dates = doc.ideas.flatMap(i => [dateValue(i.created),...i.events.map(e=>dateValue(e.date))]);
  const min = d3.min(dates) || dateValue(today());
  const start = d3.timeDay.offset(min,-8); const end = d3.timeDay.offset(dateValue(today()),22);
  baseScale = d3.scaleTime().domain([start,end]).range([34,chartWidth-34]);
  chartLayout=layoutBranches();
  const height = chartLayout.height;
  svg.attr('viewBox',`0 0 ${chartWidth} ${height}`).attr('height',height);
  zoom.extent([[0,0],[chartWidth,height]]);
}
function text(parent,x,y,content,cls,anchor='start') { return parent.append('text').attr('x',x).attr('y',y).attr('text-anchor',anchor).attr('class',cls).text(content); }
function drawChart() {
  if (!doc || !baseScale) return;
  const x = transform.rescaleX(baseScale), height = Number(svg.attr('height'));
  svg.selectAll('*').remove();
  svg.append('title').text('Idea 演化时间轴');
  svg.append('desc').text('横向为日期，蓝色粗线为主时间轴。同一家族位于主轴同侧，状态不影响上下位置。时间与文字不重叠的独立分支可共用一行，行距和留白随画布高度调整。点击分支或事件查看详情。');
  $('#empty-state').hidden = doc.ideas.length > 0;
  const range = x.domain(); $('#period-label').textContent = `${range[0].getFullYear()}年 ${range[0].getMonth()+1}月 — ${range[1].getFullYear() !== range[0].getFullYear()?range[1].getFullYear()+'年 ':''}${range[1].getMonth()+1}月`;
  $('#zoom-level').textContent = `${Math.round(transform.k*100)}%`;
  const now = x(dateValue(today()));
  const ticks = x.ticks(Math.max(3, Math.floor(chartWidth / 125)));
  for (const tick of ticks) {
    const tx = x(tick); if (tx < 15 || tx > chartWidth-20) continue;
    svg.append('line').attr('x1',tx).attr('x2',tx).attr('y1',44).attr('y2',height).attr('stroke','#e9eef1').attr('stroke-width',1);
    if(Math.abs(tx-now)>43)text(svg,tx,29,`${tick.getMonth()+1}.${String(tick.getDate()).padStart(2,'0')}`,'axis-text','middle');
  }
  if (now > 0 && now < chartWidth) {
    svg.append('rect').attr('x',now).attr('y',44).attr('width',chartWidth-now).attr('height',height-44).attr('fill','#f5f8fa').attr('opacity',.7);
    svg.append('line').attr('x1',now).attr('x2',now).attr('y1',44).attr('y2',height).attr('stroke','#9ebbb3').attr('stroke-width',1).attr('stroke-dasharray','3 5');
    svg.append('rect').attr('x',now-21).attr('y',13).attr('width',42).attr('height',23).attr('rx',5).attr('fill','#e6f0ec');
    text(svg,now,29,'今天','axis-text','middle').attr('fill','#307768').style('fill','#307768');
  }
  const {axisY,yMap}=chartLayout;
  const mainAxis=svg.append('g').attr('class','main-time-axis');
  mainAxis.append('path').attr('d',`M 0 ${axisY} H ${chartWidth-20}`).attr('stroke',MAIN_AXIS_COLOR).attr('stroke-width',4.5).attr('stroke-linecap','round').attr('fill','none');
  mainAxis.append('path').attr('d',`M ${chartWidth-28} ${axisY-7} L ${chartWidth-20} ${axisY} L ${chartWidth-28} ${axisY+7}`).attr('stroke',MAIN_AXIS_COLOR).attr('stroke-width',3.5).attr('stroke-linecap','round').attr('stroke-linejoin','round').attr('fill','none');
  mainAxis.append('rect').attr('x',12).attr('y',axisY-33).attr('width',78).attr('height',23).attr('rx',5).attr('fill','#edf3ff');
  text(mainAxis,51,axisY-17,'主时间轴','','middle').attr('font-size',12).attr('font-weight',600).attr('fill',MAIN_AXIS_COLOR);
  const axisTicks=svg.append('g').attr('class','main-axis-ticks').attr('pointer-events','none');
  for (const tick of ticks) {
    const tx=x(tick); if(tx<25||tx>chartWidth-25)continue;
    axisTicks.append('line').attr('x1',tx).attr('x2',tx).attr('y1',axisY+2).attr('y2',axisY+9).attr('stroke',MAIN_AXIS_COLOR).attr('stroke-width',1.5);
    text(axisTicks,tx,axisY+27,`${tick.getMonth()+1}.${String(tick.getDate()).padStart(2,'0')}`,'axis-text main-axis-date','middle').style('fill',MAIN_AXIS_COLOR).attr('font-weight',500).attr('paint-order','stroke').attr('stroke','#fff').attr('stroke-width',4).attr('stroke-linejoin','round');
  }
  if (!rows.length) return;
  const connectors = svg.append('g').attr('aria-hidden','true');
  for(const {idea} of rows) {
    const start=x(dateValue(idea.created)),y=yMap.get(idea.id),py=yMap.get(idea.parentId)??axisY;
    const end=x(dateValue(ideaEndDate(idea)));
    const routeWidth=chartLayout.turnWidths.get(idea.id),bend=Math.min(routeWidth,Math.max(0,end-start)),turn=routeWidth*.55;
    const parent=doc.ideas.find(i=>i.id===idea.parentId);
    if(parent) {
      const parentEnd=ideaEndDate(parent);
      if(parentEnd<idea.created) connectors.append('line').attr('x1',x(dateValue(parentEnd))).attr('x2',start).attr('y1',py).attr('y2',py).attr('stroke',idea.color).attr('stroke-width',1).attr('stroke-dasharray','2 5').attr('opacity',.45).append('title').text('衍生关联，原 idea 的状态不变');
    }
    connectors.append('path').attr('d',`M ${start} ${py} C ${start+turn} ${py} ${start+turn} ${y} ${start+bend} ${y}`).attr('class','branch-path').attr('stroke',idea.color).attr('stroke-width',1.7).attr('opacity',idea.parentId?.65:.32);
  }
  for (const {idea} of rows) {
    const y = yMap.get(idea.id), parentY = yMap.get(idea.parentId) ?? axisY;
    const start = x(dateValue(idea.created)), state = statusAt(idea), focus = idea.id === selected;
    const ordered = orderedEvents(idea);
    const endDate = ideaEndDate(idea);
    const end = x(dateValue(endDate)), bend = Math.min(chartLayout.turnWidths.get(idea.id),Math.max(0,end-start));
    const geometry=branchGeometry(idea,x,chartLayout.turnWidths.get(idea.id));
    if (focus) svg.append('rect').attr('x',Math.max(0,geometry.left-8)).attr('y',y-35).attr('width',Math.max(0,Math.min(chartWidth,geometry.right+8)-Math.max(0,geometry.left-8))).attr('height',Math.min(74,chartLayout.gap-6)).attr('fill',idea.color).attr('opacity',.035);
    const g = svg.append('g');
    const branch = g.append('g').attr('class','chart-button').attr('role','button').attr('tabindex',0).attr('aria-label',`${idea.name}，${STATES[state].label}`).on('click',()=>selectIdea(idea.id)).on('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectIdea(idea.id);}});
    branch.append('title').text(idea.name);
    branch.append('path').attr('d',`M ${start+bend} ${y} H ${Math.max(start+bend,end)}`).attr('stroke','#fff').attr('stroke-width',7).attr('fill','none');
    branch.append('path').attr('d',`M ${start+bend} ${y} H ${Math.max(start+bend,end)}`).attr('stroke',idea.color).attr('stroke-width',focus?2.7:2).attr('opacity',state==='stopped'?.5:.85).attr('class','branch-path');
    branch.append('path').attr('d',`M ${start+bend} ${y} H ${Math.max(start+bend,end)}`).attr('stroke','transparent').attr('stroke-width',26).attr('fill','none');
    branch.append('circle').attr('cx',start).attr('cy',parentY).attr('r',3.8).attr('fill','#fff').attr('stroke',idea.color).attr('stroke-width',1.7);
    // Stopped and split branches stay solid; other branches retain historical state intervals.
    const states = [{date:idea.created,status:idea.initialStatus},...ordered.filter(e=>e.status)];
    states.forEach((s,index)=>{
      if(['stopped','split'].includes(state)||!['paused','pending','stopped','completed'].includes(s.status)) return;
      const a = Math.max(start+bend,x(dateValue(s.date))), b = x(dateValue(states[index+1]?.date || endDate));
      if(b <= a) return;
      g.append('line').attr('x1',a).attr('x2',b).attr('y1',y).attr('y2',y).attr('stroke','#fff').attr('stroke-width',4).attr('pointer-events','none');
      g.append('line').attr('x1',a).attr('x2',b).attr('y1',y).attr('y2',y).attr('stroke',idea.color).attr('stroke-width',2).attr('stroke-dasharray',s.status==='paused'?'5 5':s.status==='pending'?'2 5':'1 7').attr('opacity',.6).attr('pointer-events','none');
    });
    if (end > 15 && start < chartWidth-40) {
      const lx=geometry.titleX,label=geometry.title;
      branch.append('rect').attr('x',lx-3).attr('y',y-34).attr('width',geometry.titleWidth+6).attr('height',23).attr('rx',3).attr('fill','#fff').attr('opacity',.94);
      text(branch,lx,y-18,label,'lane-title').attr('opacity',focus?1:.88);
    }
    const dateGroups=d3.group(ordered,e=>e.date);
    for (const events of dateGroups.values()) {
      const event=events.at(-1),sameDay=events.length;
      const ex = x(dateValue(event.date)); if(ex < -20 || ex > chartWidth+20) continue;
      const marker = g.append('g').attr('class','chart-button').attr('role','button').attr('tabindex',0).attr('aria-label',`${idea.name}：${event.date} ${sameDay>1?sameDay+' 条记录，':''}${event.title}`).on('click',()=>selectIdea(idea.id,event.id)).on('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();selectIdea(idea.id,event.id);}});
      marker.append('circle').attr('class','event-halo').attr('cx',ex).attr('cy',y).attr('r',15).attr('fill',idea.color).attr('opacity',selectedEvent===event.id?.15:0);
      if(sameDay>1) {marker.append('circle').attr('cx',ex).attr('cy',y).attr('r',9).attr('fill','#fff').attr('stroke',idea.color).attr('stroke-width',1.8);text(marker,ex,y+3.5,sameDay,'','middle').attr('fill',idea.color).attr('font-size',10);}
      else if(event.status) marker.append('rect').attr('x',ex-4.1).attr('y',y-4.1).attr('width',8.2).attr('height',8.2).attr('transform',`rotate(45 ${ex} ${y})`).attr('fill','#fff').attr('stroke',idea.color).attr('stroke-width',1.7);
      else marker.append('circle').attr('cx',ex).attr('cy',y).attr('r',focus?4.5:3.8).attr('fill','#fff').attr('stroke',idea.color).attr('stroke-width',1.8);
      marker.append('title').text(`${fullDate(event.date)} · ${event.title}`);
      const label=geometry.labels.get(event.date);
      if(label)text(g,label.x,y+26,label.text,`event-label ${focus?'focus':''}`);
    }
    if (end > 10 && end < chartWidth-35) {
      const cx = Math.max(start+bend,end);
      if(!dateGroups.has(endDate))g.append('circle').attr('cx',cx).attr('cy',y).attr('r',6).attr('fill',idea.color).attr('stroke','#fff').attr('stroke-width',2).attr('pointer-events','none');
      const badgeX = Math.min(chartWidth-61,cx+13);
      g.append('rect').attr('x',badgeX).attr('y',y-10).attr('width',51).attr('height',20).attr('rx',4).attr('fill',STATES[state].color+'0e').attr('pointer-events','none');
      text(g,badgeX+25.5,y+4,STATES[state].label,'','middle').attr('font-size',10).attr('fill',STATES[state].color);
    }
    if(geometry.foldLabel)text(g,geometry.titleX,y+43,geometry.foldLabel,'event-label');
  }
  axisTicks.raise();
}
function fit() { svg.transition().duration(duration()).call(zoom.transform,d3.zoomIdentity); }
function stateOptions(current, unchanged=false) { return `${unchanged?'<option value="">不改变状态</option>':''}${Object.entries(STATES).map(([k,v])=>`<option value="${k}" ${k===current?'selected':''}>${v.label}</option>`).join('')}`; }
function field(label,name,value='',{type='text',required=false,max=120,min='',readonly=false,placeholder=''}={}) {
  return `<label>${label}<input name="${name}" type="${type}" value="${escape(value)}" ${required?'required':''} maxlength="${max}" ${min?`min="${min}"`:''} ${type==='date'?`max="${today()}"`:''} ${readonly?'readonly':''} placeholder="${escape(placeholder)}"></label>`;
}
function area(label,name,value='',placeholder='',required=false) { return `<label>${label}<textarea name="${name}" maxlength="${name==='note'?10000:name==='summary'?4000:2000}" placeholder="${escape(placeholder)}" ${required?'required':''}>${escape(value)}</textarea></label>`; }
function openEditor(mode, eventId=null) {
  const idea=selectedIdea(), event=idea?.events.find(e=>e.id===eventId);
  formMode={mode,ideaId:idea?.id,eventId}; $('#form-error').hidden=true;
  let title,fields,kicker='IDEA',submit='保存';
  if(['new','edit','branch'].includes(mode)) {
    const edit=mode==='edit',branch=mode==='branch',sourceDate=event?.date;
    title=edit?'编辑 idea':branch?'让想法长出新分支':'记录一个新想法'; submit=edit?'保存修改':branch?'创建分支':'创建 idea';
    const color=edit?idea.color:PALETTE[doc.ideas.length%PALETTE.length];
    fields=`${branch?`<div class="branch-context">源于 ${escape(idea.name)}${event?` · ${escape(event.title)}`:''}<br>新分支拥有自己的状态，原 idea 保持当前状态。</div>`:''}
      ${field('简称','name',edit?idea.name:'',{required:true,max:60,placeholder:'例如：文献证据卡'})}
      ${area('核心问题 / 假设','summary',edit?idea.summary:'','用一句话说明，你想解决什么问题？')}
      <div class="form-row">${field('首次提出时间','created',edit?idea.created:sourceDate||today(),{type:'date',required:true,min:branch?idea.created:'',readonly:!!sourceDate||(edit&&!!idea.parentId)})}<label>初始状态<select name="initialStatus">${stateOptions(edit?idea.initialStatus:'pending')}</select></label></div>
      ${edit?'<p class="field-help">这里修改的是起点信息。后续状态变化请通过“记录事件”保存。</p>':''}
      <fieldset class="color-field"><legend>分支颜色</legend><div class="color-picker">${PALETTE.map((c,i)=>`<label class="color-option" style="--swatch:${c}"><input type="radio" name="color" value="${c}" aria-label="分支颜色 ${i+1}" ${c===color?'checked':''}><span></span></label>`).join('')}</div></fieldset>`;
  } else if(['event','edit-event','status'].includes(mode)) {
    const edit=mode==='edit-event'; kicker='EVENT'; title=edit?'编辑发展记录':mode==='status'?'记录一次决定':'记录一个关键事件';
    fields=`<div class="branch-context">${escape(idea.name)}</div><div class="form-row">${field('发生时间','date',event?.date||today(),{type:'date',required:true,min:idea.created})}<label>事件类型<select name="kind">${KINDS.filter(k=>k!=='衍生'||event?.kind==='衍生').map(k=>`<option ${k===(event?.kind||(mode==='status'?'状态变更':'文献调研'))?'selected':''}>${k}</option>`).join('')}</select></label></div>
      ${field('事件标题','title',event?.title||'',{required:true,max:120,placeholder:mode==='status'?'例如：等待关键数据，暂时搁置':'例如：与导师讨论研究边界'})}
      <label>这次决定<select name="status">${stateOptions(event?.status || (mode==='status'?statusAt(idea):''),true)}</select></label>
      ${area('新增认识 / 决策原因','note',event?.note||'','记录什么信息改变了你的判断。')}
      ${area('下一步 / 恢复条件 <span class="optional">选填</span>','next',event?.next||'','下一步做什么？什么条件满足后恢复？')}
      ${field('参考链接 <span class="optional">选填</span>','link',event?.link||'',{type:'url',max:2000,placeholder:'https://…'})}`;
  } else if(mode==='rename') { kicker='WORKSPACE';title='修改空间名称';fields=field('空间名称','name',doc.name,{required:true,max:60}); }
  $('#editor-title').textContent=title;$('#editor-kicker').textContent=kicker;$('#editor-fields').innerHTML=fields;$('#editor-submit').textContent=submit;icons();$('#editor').showModal();
}
async function submitEditor(e) {
  e.preventDefault(); const button=$('#editor-submit'); button.disabled=true;
  try {
    const values=Object.fromEntries(new FormData(e.currentTarget));const next=structuredClone(doc);
    const {mode,ideaId,eventId}=formMode; const idea=next.ideas.find(i=>i.id===ideaId);
    let newId=null;
    if(mode==='rename') next.name=values.name;
    else if(['new','edit','branch'].includes(mode)) {
      if(mode==='edit') Object.assign(idea,{name:values.name,summary:values.summary,created:values.created,initialStatus:values.initialStatus,color:values.color});
      else {
        const parentEvent=mode==='branch'?(eventId || id()):null;
        if(mode==='branch'&&!eventId) idea.events.push({id:parentEvent,date:values.created,kind:'衍生',title:`衍生：${values.name}`,note:'从原问题中拆出一个可以独立发展的方向。',status:null,next:'',link:'',order:Date.now()});
        newId=id();next.ideas.push({id:newId,name:values.name,summary:values.summary,created:values.created,initialStatus:values.initialStatus,color:values.color,parentId:mode==='branch'?ideaId:null,parentEventId:parentEvent,events:[]});
      }
    } else {
      if((values.kind==='状态变更'||values.status)&&!values.note.trim()) throw new Error('请补充决策原因，保留这次判断的依据。');
      if(values.kind==='状态变更'&&!values.status) throw new Error('请选择这次决定后的状态。');
      const previous=idea.events.find(ev=>ev.id===eventId);
      const event={id:eventId||id(),date:values.date,kind:values.kind,title:values.title,note:values.note,next:values.next,link:values.link,status:values.status||null,order:previous?.order ?? Date.now()};
      if(previous) {
        if(previous.date!==event.date&&next.ideas.some(i=>i.parentEventId===eventId)) throw new Error('这个事件是子 idea 的衍生起点，不能单独改变日期。');
        idea.events[idea.events.indexOf(previous)]=event;
      } else idea.events.push(event);
      selectedEvent=event.id;
    }
    validateDocument(next);
    if(newId) { selected=newId;selectedEvent=null;collapsed.delete(ideaId);detailOpen=true; }
    await commit(next,mode==='branch'?'新的分支已生长出来':mode==='new'?'已记录这个想法':'修改已保存');
    $('#editor').close(); if(newId)fit();
  } catch(error) { $('#form-error').textContent=error.message;$('#form-error').hidden=false; }
  finally {button.disabled=false;}
}
function confirmAction(title,message,label='确认') {
  $('#confirm-title').textContent=title;$('#confirm-text').textContent=message;$('#confirm-ok').textContent=label;
  const dialog=$('#confirm');dialog.returnValue='';dialog.showModal();return new Promise(resolve=>dialog.addEventListener('close',()=>resolve(dialog.returnValue==='yes'),{once:true}));
}
async function deleteEvent(eventId) {
  if(doc.ideas.some(i=>i.parentEventId===eventId)) {notify('这个事件是子 idea 的衍生起点。请先删除对应子分支。');return;}
  if(!await confirmAction('删除这条记录？','这也会移除它带来的状态变化。其他事件保持不变。','删除记录'))return;
  const next=structuredClone(doc);next.ideas.find(i=>i.id===selected).events=next.ideas.find(i=>i.id===selected).events.filter(e=>e.id!==eventId);selectedEvent=null;await commit(next,'记录已删除');
}
async function deleteIdea() {
  const idea=selectedIdea();const ids=descendants(doc.ideas,selected);
  if(!await confirmAction('删除这个 idea？',`将删除“${idea.name}”${ids.size>1?`及其 ${ids.size-1} 个子分支`:''}与所有相关记录。项目目录会保留近期自动备份。`,'删除 idea'))return;
  const next=structuredClone(doc);next.ideas=next.ideas.filter(i=>!ids.has(i.id));selected=idea.parentId;selectedEvent=null;await commit(next,'Idea 已删除');
}
function exportData() {
  const blob=new Blob([JSON.stringify(doc,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=`IdeaTree-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('备份已导出');
}
async function importData(file) {
  if(!file)return;
  try {
    if(file.size>5_000_000)throw new Error('备份文件不能超过 5 MB。');
    const imported=validateDocument(JSON.parse(await file.text()));
    if(!await confirmAction('用备份恢复空间？',`将载入“${imported.name}”的 ${imported.ideas.length} 个 idea，并替换当前空间。当前记录会先保留在自动备份中。`,'恢复备份'))return;
    selected=null;selectedEvent=null;collapsed.clear();await commit(imported,'备份已恢复');fit();
  } catch(error) {notify(`导入失败：${error.message}`);} finally {$('#import-file').value='';}
}
document.addEventListener('click',async e=>{
  const select=e.target.closest('[data-select]');if(select){selectIdea(select.dataset.select);return;}
  const collapse=e.target.closest('[data-collapse]');if(collapse){const key=collapse.dataset.collapse;collapsed.has(key)?collapsed.delete(key):collapsed.add(key);render();return;}
  const button=e.target.closest('[data-action]');if(!button)return;
  try {
    switch(button.dataset.action){
      case 'toggle-archive':archiveOpen=!archiveOpen;renderNavigation();icons();$('#idea-list [data-action="toggle-archive"]').focus();break;
      case 'edit-idea':openEditor('edit');break;
      case 'add-event':openEditor('event');break;
      case 'status':openEditor('status');break;
      case 'branch':openEditor('branch',button.dataset.event);break;
      case 'edit-event':openEditor('edit-event',button.dataset.event);break;
      case 'delete-event':await deleteEvent(button.dataset.event);break;
      case 'delete-idea':await deleteIdea();break;
      case 'close-detail':detailOpen=false;render();break;
    }
  }catch(error){notify(error.message);}
});
$('#editor-form').addEventListener('submit',submitEditor);
document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$('#editor').close());
$('#new-idea').onclick=()=>openEditor('new');$('#empty-create').onclick=()=>openEditor('new');$('#rename-space').onclick=()=>openEditor('rename');
function setSidebar(open){$('#sidebar').classList.toggle('open',open);$('#toggle-sidebar').setAttribute('aria-expanded',open);}
$('#toggle-sidebar').onclick=()=>setSidebar(!$('#sidebar').classList.contains('open'));
$('#close-sidebar').onclick=()=>{setSidebar(false);$('#toggle-sidebar').focus();};
$('#toggle-detail').onclick=()=>{detailOpen=!detailOpen;render();};
$('#zoom-in').onclick=()=>svg.transition().duration(duration()).call(zoom.scaleBy,1.35);
$('#zoom-out').onclick=()=>svg.transition().duration(duration()).call(zoom.scaleBy,1/1.35);
$('#pan-left').onclick=()=>svg.transition().duration(duration()).call(zoom.translateBy,chartWidth*.35/transform.k,0);
$('#pan-right').onclick=()=>svg.transition().duration(duration()).call(zoom.translateBy,-chartWidth*.35/transform.k,0);
$('#fit').onclick=fit;
$('#go-today').onclick=()=>svg.transition().duration(duration()).call(zoom.translateTo,baseScale(dateValue(today())),0,[chartWidth*.72,0]);
$('#export').onclick=exportData;$('#import').onclick=()=>$('#import-file').click();$('#import-file').onchange=e=>importData(e.target.files[0]);
$('#start-empty').onclick=async()=>{
  if(!await confirmAction('开始自己的记录？','将清空当前示例空间（包括在示例中新增的内容），为你的第一个 idea 留出位置。需要保留时，请先导出备份。','开始记录'))return;
  try{selected=null;selectedEvent=null;collapsed.clear();await commit({version:1,name:'我的研究',demo:false,ideas:[]},'空间已准备好');fit();}catch(error){notify(error.message);}
};
$('#retry-load').onclick=()=>location.reload();
window.addEventListener('beforeunload',e=>{if(pendingSaves||saveBlocked){e.preventDefault();e.returnValue='';}});
document.addEventListener('keydown',e=>{if(e.key==='Escape')setSidebar(false);});
new ResizeObserver(()=>{if(doc){setupScale();drawChart();}}).observe($('#chart-scroll'));
async function init(){try{const response=await fetch('/api/data');if(!response.ok)throw new Error('请确认本地服务正在运行。');const data=await response.json();doc=validateDocument(data);revision=data.revision;selected=doc.demo?'evidence':(doc.ideas.find(idea=>statusAt(idea)==='active')||doc.ideas.find(idea=>statusAt(idea)!=='stopped')||doc.ideas[0])?.id;archiveOpen=!!selected&&statusAt(selectedIdea())==='stopped';render();}catch(error){$('#load-error-message').textContent=error.message;$('#load-error').hidden=false;}}
init();
