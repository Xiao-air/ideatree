import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo, validateDocument, statusAt, ideaEndDate, treeRows, descendants, today } from '../public/model.mjs';

test('demo has valid independent roots and anchored children',()=>{
  const doc=validateDocument(makeDemo());assert.equal(doc.ideas.length,6);
  assert.equal(treeRows(doc.ideas).length,6);assert.equal(treeRows(doc.ideas,new Set(['reading'])).length,4);
  assert.deepEqual([...descendants(doc.ideas,'reading')].sort(),['claims','evidence','reading']);
});
test('status history is chronological and restart preserves prior decisions',()=>{
  const idea=makeDemo().ideas.find(i=>i.id==='notes');
  assert.equal(statusAt(idea),'stopped');
  assert.equal(statusAt(idea,idea.created),'active');
  idea.events.push({id:'restart',date:today(),status:'active',order:200});
  assert.equal(statusAt(idea),'active');assert.equal(idea.events.filter(e=>e.status==='stopped').length,1);
  idea.events.push({id:'pause',date:today(),status:'paused',order:201});assert.equal(statusAt(idea),'paused');
});
test('branching does not alter parent status',()=>{
  const doc=makeDemo();assert.equal(statusAt(doc.ideas.find(i=>i.id==='notes')),'stopped');
  assert.equal(statusAt(doc.ideas.find(i=>i.id==='failures')),'pending');
  assert.equal(statusAt(doc.ideas.find(i=>i.id==='reading')),'active');
});
test('split is an explicit decision with a fixed end date and independent children',()=>{
  const doc=makeDemo(),parent=doc.ideas.find(i=>i.id==='notes'),child=doc.ideas.find(i=>i.id==='failures');
  const decision=parent.events.find(e=>e.status==='stopped');decision.status='split';
  parent.events.push({id:'later-note',date:today(),kind:'灵感记录',title:'补充说明',order:200});
  const restored=validateDocument(JSON.parse(JSON.stringify(doc))),saved=restored.ideas.find(i=>i.id===parent.id);
  assert.equal(statusAt(saved),'split');assert.equal(ideaEndDate(saved,'2099-01-01'),decision.date);
  assert.equal(statusAt(restored.ideas.find(i=>i.id===child.id)),'pending');
  assert.equal(treeRows(restored.ideas).length,doc.ideas.length);
});
test('a split direction can restart without erasing its split decision',()=>{
  const doc=makeDemo(),parent=doc.ideas.find(i=>i.id==='notes');parent.events.at(-1).status='split';
  parent.events.push({id:'resume',date:today(),kind:'状态变更',title:'恢复独立研究',note:'出现新的独立问题',status:'active',order:200});
  const saved=validateDocument(doc).ideas.find(i=>i.id===parent.id);
  assert.equal(statusAt(saved),'active');assert.equal(ideaEndDate(saved,'2099-01-01'),'2099-01-01');
  assert.equal(saved.events.filter(e=>e.status==='split').length,1);
});
test('split requires a child direction to carry the work forward',()=>{
  const doc=makeDemo(),idea=doc.ideas.find(i=>i.id==='weekly');idea.events.at(-1).status='split';
  assert.throws(()=>validateDocument(doc),/承接工作的子 idea/);
  idea.events=[];idea.initialStatus='split';assert.throws(()=>validateDocument(doc),/承接工作的子 idea/);
});
test('all stopped branches automatically archive a split parent and reopening restores it',()=>{
  const doc=makeDemo(),parent=doc.ideas.find(i=>i.id==='notes'),child=doc.ideas.find(i=>i.id==='failures');
  parent.events.at(-1).status='split';child.events.push({id:'child-stop',date:today(),kind:'状态变更',title:'中止子方向',status:'stopped',order:200});
  const stopped=validateDocument(doc),saved=stopped.ideas.find(i=>i.id===parent.id);
  assert.equal(statusAt(saved),'stopped');assert.equal(saved.events.at(-1).date,today());assert.match(saved.events.at(-1).id,/^auto-stop-/);
  assert.deepEqual(validateDocument(stopped),stopped);
  stopped.ideas.find(i=>i.id===child.id).events.push({id:'child-resume',date:today(),kind:'状态变更',title:'恢复子方向',status:'active',order:201});
  const resumed=validateDocument(stopped);assert.equal(statusAt(resumed.ideas.find(i=>i.id===parent.id)),'split');
  assert.equal(resumed.ideas.find(i=>i.id===parent.id).events.filter(e=>e.status==='stopped').length,1);
  const manuallyStopped=makeDemo();manuallyStopped.ideas.find(i=>i.id==='failures').initialStatus='active';
  assert.equal(statusAt(validateDocument(manuallyStopped).ideas.find(i=>i.id==='notes')),'stopped');
});
test('split parents close recursively but an active descendant or completed child prevents premature archiving',()=>{
  const doc=makeDemo(),root=doc.ideas.find(i=>i.id==='reading');
  root.events.push({id:'root-split',date:today(),kind:'状态变更',title:'拆分',status:'split',order:200});
  for(const id of ['evidence','claims'])doc.ideas.find(i=>i.id===id).events.push({id:id+'-stop',date:today(),kind:'状态变更',title:'中止',status:'stopped',order:201});
  const grandchild={id:'grandchild',name:'下层研究',summary:'',created:today(),initialStatus:'active',color:root.color,parentId:'evidence',parentEventId:'evidence-stop',events:[]};doc.ideas.push(grandchild);
  assert.equal(statusAt(validateDocument(doc).ideas.find(i=>i.id===root.id)),'split');
  grandchild.initialStatus='stopped';doc.ideas.find(i=>i.id==='evidence').events.at(-1).status='split';
  const closed=validateDocument(doc);assert.equal(statusAt(closed.ideas.find(i=>i.id==='evidence')),'stopped');assert.equal(statusAt(closed.ideas.find(i=>i.id===root.id)),'stopped');
  doc.ideas.find(i=>i.id==='claims').events.at(-1).status='completed';assert.equal(statusAt(validateDocument(doc).ideas.find(i=>i.id===root.id)),'split');
});
test('imports reject invalid dates, states, duplicate ids, unsafe links, and broken anchors',()=>{
  const cases=[
    d=>d.ideas[0].created='2026-02-30',
    d=>d.ideas[0].initialStatus='unknown',
    d=>d.ideas[1].id=d.ideas[0].id,
    d=>d.ideas[0].events[0].link='javascript:alert(1)',
    d=>d.ideas[1].parentEventId='missing',
    d=>d.ideas[1].created='2020-01-01',
    d=>d.ideas[1].parentId=d.ideas[1].id,
    d=>d.ideas[0].events[0].date='2000-01-01',
  ];
  for(const mutate of cases){const doc=makeDemo();mutate(doc);assert.throws(()=>validateDocument(doc));}
});
test('cycle detection terminates and rejects circular inheritance',()=>{
  const d=makeDemo();const [a,b]=d.ideas;
  a.created=b.created=today();a.events=[{id:'a',date:today(),title:'a',kind:'衍生',order:1}];b.events=[{id:'b',date:today(),title:'b',kind:'衍生',order:1}];
  a.parentId=b.id;a.parentEventId='b';b.parentId=a.id;b.parentEventId='a';d.ideas=[a,b];
  assert.throws(()=>validateDocument(d),/循环/);
});
test('empty workspace and Unicode text round-trip',()=>{
  assert.deepEqual(validateDocument({version:1,name:'我的研究',ideas:[],demo:false}),{version:1,name:'我的研究',ideas:[],demo:false});
  const d=makeDemo();d.ideas[0].name='中文想法 α / β';assert.equal(validateDocument(JSON.parse(JSON.stringify(d))).ideas[0].name,'中文想法 α / β');
});
