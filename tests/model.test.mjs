import test from 'node:test';
import assert from 'node:assert/strict';
import { makeDemo, validateDocument, statusAt, treeRows, descendants, today } from '../public/model.mjs';

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
