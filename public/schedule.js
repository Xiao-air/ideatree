import { SCHEDULE_COLORS, localDate, addDays, weekStart, timeLabel, validateSchedule, packDay } from './schedule-model.mjs';

const $ = selector => document.querySelector(selector);
const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const weekdays = ['周一','周二','周三','周四','周五','周六','周日'];
const HOUR = 56, grid = $('#time-grid'), scroll = $('#calendar-scroll'), editor = $('#plan-editor');
let doc = {version:1,entries:[]}, revision = 0, monday = weekStart(localDate()), editing = null, editorMode = 'schedule', schedulingWork = false, workOpen = true, selection = null, saving = false, blocked = false, loaded = false, toastTimer;
const icons = () => window.lucide?.createIcons({attrs:{'aria-hidden':'true'}});
const weekEntries = () => doc.entries.filter(entry=>entry.date&&entry.date>=monday&&entry.date<=addDays(monday,6)).sort((a,b)=>a.date.localeCompare(b.date)||a.start-b.start);
function toast(message) { clearTimeout(toastTimer); $('#planner-toast').textContent=message;$('#planner-toast').hidden=false;toastTimer=setTimeout(()=>$('#planner-toast').hidden=true,3000); }
function saveState(message,error=false) { $('#schedule-save-state').textContent=message;$('#schedule-save-state').classList.toggle('error',error); }
function render() {
  const end=addDays(monday,6), entries=weekEntries(), work=doc.entries.filter(entry=>entry.week===monday), today=localDate();
  $('#week-label').textContent=`${monday.replaceAll('-','.')} — ${end.slice(5).replace('-','.')}`;
  $('#week-date').value=monday;
  $('#calendar-header').innerHTML='<div class="calendar-corner">时间</div>'+weekdays.map((name,index)=>{const date=addDays(monday,index);return `<div class="day-heading ${date===today?'today':''} ${index>4?'weekend':''}"><span>${name} · ${date.slice(5).replace('-','/')}</span><strong>${Number(date.slice(8))}</strong></div>`;}).join('');
  grid.querySelectorAll('.day-column').forEach(column=>column.remove());
  for(let index=0;index<7;index++) {
    const date=addDays(monday,index), column=document.createElement('div');
    column.className=`day-column ${date===today?'today':''} ${index>4?'weekend':''}`;
    column.dataset.day=index;column.tabIndex=0;column.setAttribute('role','group');column.setAttribute('aria-label',`${weekdays[index]} ${date}，框选时间或按回车新建安排`);
    column.innerHTML=packDay(entries.filter(entry=>entry.date===date)).map(({entry,column:slot,columns})=>`<button class="plan-card ${entry.end-entry.start<45?'compact':''}" data-entry="${escape(entry.id)}" style="--event-color:${entry.color};top:${entry.start/60*HOUR}px;height:${Math.max(12,(entry.end-entry.start)/60*HOUR-2)}px;left:calc(${slot/columns*100}% + 3px);width:calc(${100/columns}% - 6px)" aria-label="${escape(entry.title)}，${date} ${timeLabel(entry.start)}至${timeLabel(entry.end)}" title="${escape(entry.title)} · ${timeLabel(entry.start)}–${timeLabel(entry.end)}${entry.note?'\n'+escape(entry.note):''}"><strong>${escape(entry.title)}</strong><span class="plan-time">${timeLabel(entry.start)} – ${timeLabel(entry.end)}</span><span class="plan-note">${escape(entry.note)}</span></button>`).join('');
    if(date===today) {const now=new Date(),line=document.createElement('div');line.className='now-line';line.style.top=`${(now.getHours()+now.getMinutes()/60)*HOUR}px`;column.append(line);}
    grid.append(column);
  }
  $('#agenda-count').textContent=entries.length;
  $('#week-work-count').textContent=`${work.length} 项待安排`;
  $('#week-work-list').innerHTML=work.length?work.map(entry=>`<article class="week-work-card" style="--event-color:${entry.color}"><button class="week-work-title" data-work-edit="${escape(entry.id)}" title="编辑 ${escape(entry.title)}">${escape(entry.title)}</button>${entry.note?`<p title="${escape(entry.note)}">${escape(entry.note)}</p>`:'<p class="work-no-note">时间确定后再排入日程</p>'}<div class="week-work-actions"><button data-work-edit="${escape(entry.id)}">编辑</button><button data-work-schedule="${escape(entry.id)}">安排时间<i data-lucide="arrow-up-right"></i></button></div></article>`).join(''):'<p class="week-work-empty">先记下本周要做的实验，时间可以稍后确定。<button data-new-work>记录第一项工作</button></p>';
  $('#week-agenda').innerHTML=entries.length?entries.map(entry=>`<button class="agenda-item" data-entry="${escape(entry.id)}" style="--event-color:${entry.color}"><small>${entry.date.slice(5).replace('-','/')} · ${timeLabel(entry.start)}–${timeLabel(entry.end)}</small><strong>${escape(entry.title)}</strong></button>`).join(''):'<p class="agenda-empty">这一周还没有实验安排。<br>在右侧框选时段，或点击“新建安排”。</p>';
  const hours=entries.reduce((sum,entry)=>sum+entry.end-entry.start,0)/60;
  $('#week-summary').textContent=`本周已安排 ${entries.length} 项 · 待安排 ${work.length} 项${hours?` · ${Number(hours.toFixed(2))} 小时`:''}`;
  icons();
}
function changeWeek(date) { monday=weekStart(date); selection=null;render(); }
function openEditor(entry=null,range=null,mode='schedule') {
  if(!loaded) return;
  editing=entry?.id||null;editorMode=mode;schedulingWork=mode==='schedule'&&!!entry?.week;
  const workOnly=mode==='work';
  const date=entry?.date||range?.date||(localDate()>=monday&&localDate()<=addDays(monday,6)?localDate():monday);
  $('#plan-form').reset();$('#plan-error').hidden=true;
  $('#plan-editor-title').textContent=workOnly?(entry?'编辑本周工作':'记录本周实验工作'):schedulingWork?'为本周工作安排时间':entry?'编辑实验安排':'新建实验安排';
  $('#save-plan').textContent=workOnly?'保存工作':schedulingWork?'排入日程':'保存安排';
  $('#delete-plan').textContent=workOnly?'删除工作':'删除安排';
  $('#work-week-label').hidden=!workOnly;$('#work-week').disabled=!workOnly;$('#work-week').value=entry?.week||monday;
  for(const selector of ['#plan-date-fields','#plan-time-fields']){$(selector).hidden=workOnly;$(selector).querySelectorAll('input,select').forEach(input=>input.disabled=workOnly);}
  $('#plan-note').placeholder=workOnly?'记录要做的实验、准备工作，或备注“待预约仪器 / 待协调时间”。':'写下实验步骤、待准备的材料或需要注意的条件。';
  $('#plan-title').value=entry?.title||'';$('#plan-note').value=entry?.note||'';
  $('#plan-date').value=date;$('#plan-until').value=range?.until||date;
  $('#plan-until').min=date;$('#plan-until').max=addDays(date,6);
  $('#plan-until-label').hidden=!!entry;$('#plan-range-help').hidden=workOnly||!!entry;
  $('#plan-start').value=entry?.start??range?.start??540;$('#plan-end').value=entry?.end??range?.end??600;
  $('#plan-colors').innerHTML=SCHEDULE_COLORS.map((color,index)=>`<label class="plan-color-option" style="--event-color:${color}"><input type="radio" name="color" value="${color}" aria-label="卡片颜色 ${index+1}" ${color===(entry?.color||SCHEDULE_COLORS[0])?'checked':''}><span></span></label>`).join('');
  $('#delete-plan').hidden=!entry||schedulingWork;editor.showModal();requestAnimationFrame(()=>$('#plan-title').focus());
}
async function commit(candidate) {
  if(blocked) throw new Error('保存已暂停。请导出当前安排，再刷新页面。');
  const clean=validateSchedule(candidate);doc=clean;saving=true;saveState('正在保存…');
  try {
    const response=await fetch('/api/schedule',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({...clean,revision})});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'保存失败');
    revision=result.revision;saveState('已保存在本机');render();
  } catch(error) {blocked=true;saveState('尚未保存 · 请导出当前安排',true);throw error;}
  finally {saving=false;}
}
$('#plan-form').addEventListener('submit',async event=>{
  event.preventDefault();$('#save-plan').disabled=true;$('#plan-error').hidden=true;
  try {
    const values=Object.fromEntries(new FormData(event.currentTarget));
    const next=structuredClone(doc);next.entries=next.entries.filter(entry=>entry.id!==editing);
    if(editorMode==='work') {
      next.entries.push({id:editing||crypto.randomUUID(),title:values.title,week:weekStart(values.week),note:values.note,color:values.color});
      monday=weekStart(values.week);
    } else {
      const until=editing?values.date:$('#plan-until').value;
      if(until<values.date||until>addDays(values.date,6))throw new Error('结束日期应在开始日期之后，最多连续选择 7 天。');
      for(let date=values.date;date<=until;date=addDays(date,1)) next.entries.push({id:editing||crypto.randomUUID(),title:values.title,date,start:Number(values.start),end:Number(values.end),note:values.note,color:values.color});
      monday=weekStart(values.date);
    }
    validateSchedule(next);await commit(next);editor.close();toast(editorMode==='work'?'本周工作已保存':schedulingWork?'工作已排入日程':editing?'安排已更新':'实验安排已保存');
  } catch(error) {$('#plan-error').textContent=error.message;$('#plan-error').hidden=false;}
  finally {$('#save-plan').disabled=false;}
});
$('#delete-plan').onclick=async()=>{
  const entry=doc.entries.find(item=>item.id===editing);if(!entry||!confirm(`删除“${entry.title}”的这项${entry.week?'工作':'安排'}？`))return;
  $('#delete-plan').disabled=true;
  try {await commit({...doc,entries:doc.entries.filter(item=>item.id!==editing)});editor.close();toast(entry.week?'工作已删除':'安排已删除');}
  catch(error){$('#plan-error').textContent=error.message;$('#plan-error').hidden=false;}
  finally{$('#delete-plan').disabled=false;}
};
function clearSelection() {selection=null;grid.querySelectorAll('.time-selection').forEach(element=>element.remove());}
function gridPoint(event) {
  const columns=[...grid.querySelectorAll('.day-column')], first=columns[0].getBoundingClientRect(), last=columns.at(-1).getBoundingClientRect();
  return {day:Math.max(0,Math.min(6,Math.floor((event.clientX-first.left)/first.width))),minute:Math.max(0,Math.min(1440,Math.round((event.clientY-first.top)/HOUR*60/15)*15)),inside:event.clientX>=first.left&&event.clientX<=last.right};
}
function selectedRange() {
  const start=Math.min(selection.anchor.minute,selection.current.minute),end=Math.max(selection.anchor.minute,selection.current.minute);
  return {first:Math.min(selection.anchor.day,selection.current.day),last:Math.max(selection.anchor.day,selection.current.day),start:Math.min(1425,start),end:end===start?Math.min(1440,start+15):end};
}
function paintSelection() {
  grid.querySelectorAll('.time-selection').forEach(element=>element.remove());const range=selectedRange();
  for(let day=range.first;day<=range.last;day++){const preview=document.createElement('div');preview.className='time-selection';preview.style.top=`${range.start/60*HOUR}px`;preview.style.height=`${(range.end-range.start)/60*HOUR}px`;preview.innerHTML=`<span class="selection-label">${timeLabel(range.start)}–${timeLabel(range.end)}</span>`;grid.querySelector(`[data-day="${day}"]`).append(preview);}
}
grid.addEventListener('pointerdown',event=>{
  if(event.button!==0||event.pointerType==='touch'||event.target.closest('.plan-card')||!event.target.closest('.day-column')||!loaded)return;
  event.preventDefault();const point=gridPoint(event);point.minute=Math.min(point.minute,1425);selection={anchor:point,current:point,pointer:event.pointerId};grid.setPointerCapture(event.pointerId);paintSelection();
});
grid.addEventListener('pointermove',event=>{
  if(!selection||event.pointerId!==selection.pointer)return;
  const bounds=scroll.getBoundingClientRect();if(event.clientY>bounds.bottom-28)scroll.scrollTop+=20;else if(event.clientY<bounds.top+95)scroll.scrollTop-=20;
  selection.current=gridPoint(event);paintSelection();
});
grid.addEventListener('pointerup',event=>{
  if(!selection||event.pointerId!==selection.pointer)return;
  const range=selectedRange();if(grid.hasPointerCapture(event.pointerId))grid.releasePointerCapture(event.pointerId);clearSelection();
  openEditor(null,{date:addDays(monday,range.first),until:addDays(monday,range.last),start:range.start,end:range.end});
});
grid.addEventListener('pointercancel',clearSelection);
grid.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('.day-column')){event.preventDefault();openEditor(null,{date:addDays(monday,Number(event.target.dataset.day)),start:540,end:600});}});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&selection)clearSelection();});
document.addEventListener('click',event=>{const work=event.target.closest('[data-work-edit],[data-work-schedule],[data-new-work]');if(work){const id=work.dataset.workEdit||work.dataset.workSchedule;openEditor(doc.entries.find(entry=>entry.id===id)||null,null,work.hasAttribute('data-work-schedule')?'schedule':'work');return;}const card=event.target.closest('[data-entry]');if(card){openEditor(doc.entries.find(entry=>entry.id===card.dataset.entry));return;}if(event.pointerType==='touch'&&event.target.matches('.day-column')){const point=gridPoint(event);openEditor(null,{date:addDays(monday,point.day),start:Math.min(point.minute,1425),end:Math.min(point.minute+60,1440)});}});
$('#new-plan').onclick=()=>openEditor();$('#close-plan').onclick=$('#cancel-plan').onclick=()=>editor.close();
$('#new-week-work').onclick=()=>openEditor(null,null,'work');
$('#toggle-week-work').onclick=()=>{workOpen=!workOpen;$('#toggle-week-work').setAttribute('aria-expanded',workOpen);$('#week-work-body').hidden=!workOpen;};
$('#plan-date').onchange=()=>{const date=$('#plan-date').value;if(date){$('#plan-until').value=date;$('#plan-until').min=date;$('#plan-until').max=addDays(date,6);}};
$('#previous-week').onclick=()=>changeWeek(addDays(monday,-7));$('#next-week').onclick=()=>changeWeek(addDays(monday,7));$('#this-week').onclick=()=>changeWeek(localDate());$('#week-date').onchange=event=>{if(event.target.value)changeWeek(event.target.value);};
$('#schedule-export').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(doc,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`IdeaTree-实验安排-${localDate()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('#schedule-import').onclick=()=>$('#schedule-file').click();$('#schedule-file').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>5_000_000)throw new Error('安排备份不能超过 5 MB。');const imported=validateSchedule(JSON.parse(await file.text()));const work=imported.entries.filter(entry=>entry.week).length;if(!confirm(`用备份中的 ${imported.entries.length-work} 项日程和 ${work} 项待安排工作替换当前全部安排？`))return;await commit(imported);toast('实验安排已导入');}catch(error){toast(error.message);}finally{event.target.value='';}};
window.addEventListener('beforeunload',event=>{if(saving||blocked){event.preventDefault();event.returnValue='';}});
$('#time-ruler').innerHTML=Array.from({length:24},(_,hour)=>`<span style="top:${hour*HOUR}px">${timeLabel(hour*60)}</span>`).join('');
$('#plan-start').innerHTML=Array.from({length:288},(_,index)=>`<option value="${index*5}">${timeLabel(index*5)}</option>`).join('');
$('#plan-end').innerHTML=Array.from({length:288},(_,index)=>`<option value="${(index+1)*5}">${timeLabel((index+1)*5)}</option>`).join('');
async function init() {try{const response=await fetch('/api/schedule'),data=await response.json();if(!response.ok)throw new Error(data.error||'无法读取实验安排');doc=validateSchedule(data);revision=data.revision;loaded=true;render();requestAnimationFrame(()=>{scroll.scrollTop=8*HOUR-12;});}catch(error){$('#planner-notice').textContent=error.message;$('#planner-notice').hidden=false;$('#new-plan').disabled=true;}icons();}
init();
