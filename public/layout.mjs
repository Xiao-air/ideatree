export function familySides(ideas) {
  const children=new Map(),sides=new Map(),loads=[0,0];
  for(const idea of ideas) {
    if(!children.has(idea.parentId))children.set(idea.parentId,[]);
    children.get(idea.parentId).push(idea);
  }
  function assign(idea,side) {
    sides.set(idea.id,side);loads[side]++;
    for(const child of children.get(idea.id)||[])assign(child,side);
  }
  for(const root of [...(children.get(null)||[])].sort((a,b)=>a.created.localeCompare(b.created)))assign(root,loads[0]<=loads[1]?0:1);
  return sides;
}

export function fitVertical(depths,available,minimum=64) {
  const count=depths[0]+depths[1],height=Math.max(available,122+count*minimum);
  const gap=count?Math.min(112,(height-122)/count):minimum;
  const padding=count?(height-122-count*gap)/2:0;
  return {height,gap,axisY:76+padding+depths[0]*gap};
}

// Newer branches claim inner lanes first; family members stay on one side.
export function packLanes(entries) {
  const positions = new Map(), placed = [[],[]], depths = [0,0],links=[];
  const remaining=[...entries].sort((a,b)=>b.start-a.start),byId=new Map(entries.map(entry=>[entry.id,entry]));
  while(remaining.length) {
    const index=remaining.findIndex(entry=>!byId.has(entry.parentId)||positions.has(entry.parentId));
    const [entry]=remaining.splice(index,1);
    const side = entry.side, parent=positions.get(entry.parentId),source=parent?.lane||0;
    const peers = placed[side];
    let best;
    for (let lane = source+1; lane <= Math.max(depths[side]+1,source+1); lane++) {
      if (peers.some(other => other.lane === lane && entry.left < other.right+10 && entry.right > other.left-10)) continue;
      const turnWidth = Math.max(8,20-lane*2), turnX = entry.start+turnWidth*.55;
      const crossings = peers.filter(other => other.lane > source && other.lane < lane && turnX > other.left && turnX < other.right).length+
        links.filter(link=>link.side===side&&lane>link.source&&lane<link.lane&&link.x>entry.left&&link.x<entry.right).length;
      const score = crossings*1000+lane-source;
      if (!best || score < best.score) best = {lane,turnWidth,turnX,score};
      if (!crossings) break;
    }
    const position = {...entry,...best,source};
    positions.set(entry.id,position);peers.push(position);
    links.push({side,source,lane:position.lane,x:position.turnX});
    depths[side] = Math.max(depths[side],position.lane);
  }
  return {positions,depths};
}
