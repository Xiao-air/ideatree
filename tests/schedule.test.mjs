import test from 'node:test';
import assert from 'node:assert/strict';
import { weekStart,addDays,validateSchedule,packDay,timeLabel } from '../public/schedule-model.mjs';

const entry=(id,start=540,end=600)=>({id,title:'水凝胶实验',date:'2026-10-19',start,end,note:'准备培养基\n细胞接种',color:'#277d72'});
test('weeks run Monday through Sunday across year and month boundaries',()=>{
  assert.equal(weekStart('2026-10-19'),'2026-10-19');assert.equal(weekStart('2026-10-25'),'2026-10-19');
  assert.equal(weekStart('2027-01-01'),'2026-12-28');assert.equal(addDays('2026-12-28',6),'2027-01-03');assert.equal(timeLabel(1440),'24:00');
});
test('schedule round-trips future plans, Unicode notes, empty weeks and midnight boundaries',()=>{
  const doc={version:1,entries:[entry('a'),{...entry('b',1425,1440),date:'2030-01-01'}]};
  assert.deepEqual(validateSchedule(JSON.parse(JSON.stringify(doc))),doc);assert.deepEqual(validateSchedule({version:1,entries:[]}),{version:1,entries:[]});
});
test('schedule rejects malformed times, dates, duplicate ids and excessive text',()=>{
  const cases=[item=>item.end=item.start,item=>item.end=1441,item=>item.start=541,item=>item.date='2026-02-30',item=>item.title='',item=>item.note='a'.repeat(4001)];
  for(const change of cases){const item=entry('a');change(item);assert.throws(()=>validateSchedule({version:1,entries:[item]}));}
  assert.throws(()=>validateSchedule({version:1,entries:[entry('a'),entry('a')]}));
});
test('course times keep five-minute precision when saved beside existing experiments',()=>{
  const course={...entry('course',595,750),title:'课程',note:'09:55–10:40、10:50–11:35、11:45–12:30'};
  const doc={version:1,entries:[entry('experiment'),course,entry('late',1435,1440)]};
  assert.deepEqual(validateSchedule(JSON.parse(JSON.stringify(doc))),doc);
  const packed=packDay(doc.entries);
  assert.notEqual(packed.find(item=>item.entry.id==='course').column,packed.find(item=>item.entry.id==='experiment').column);
});
test('overlapping cards occupy different columns while adjacent periods reuse space',()=>{
  const packed=packDay([entry('a',540,600),entry('b',570,630),entry('c',600,660),entry('d',660,720)]);
  for(const left of packed)for(const right of packed){if(left.entry.id!==right.entry.id&&left.entry.start<right.entry.end&&right.entry.start<left.entry.end)assert.notEqual(left.column,right.column);}
  assert.equal(packed.find(item=>item.entry.id==='d').columns,1);assert.equal(packed.find(item=>item.entry.id==='a').columns,2);
});
test('weekly work can be recorded without a date or time and coexist with scheduled experiments',()=>{
  const work={id:'pending',title:'预约流变仪测试',week:'2026-10-19',note:'等待仪器预约和协作者确认。',color:'#5b73ae'};
  const doc={version:1,entries:[entry('scheduled'),work]};
  assert.deepEqual(validateSchedule(JSON.parse(JSON.stringify(doc))),doc);
  assert.equal(Object.hasOwn(validateSchedule(doc).entries[1],'start'),false);
  const wrongWeek={...work,week:'2026-10-20'};assert.throws(()=>validateSchedule({version:1,entries:[wrongWeek]}),/所属周/);
  assert.throws(()=>validateSchedule({version:1,entries:[{...work,date:'2026-10-19',start:540,end:600}]}),/不能同时/);
});
test('scheduling a weekly work item preserves its identity and content without duplicating it',()=>{
  const work={id:'pending',title:'协作细胞实验',week:'2026-10-19',note:'等待协作者时间。',color:'#9373a5'};
  const before=validateSchedule({version:1,entries:[entry('existing'),work]});
  const scheduled={id:work.id,title:work.title,note:work.note,color:work.color,date:'2026-10-22',start:780,end:900};
  const after=validateSchedule({...before,entries:before.entries.map(item=>item.id===work.id?scheduled:item)});
  assert.equal(after.entries.length,2);assert.deepEqual(after.entries[0],before.entries[0]);assert.deepEqual(after.entries[1],scheduled);
  assert.equal(after.entries.filter(item=>item.week).length,0);
  assert.throws(()=>validateSchedule({version:1,entries:[work,scheduled]}),/编号/);
});
