import type { CenterlinePath, CenterlinePoint, CenterlineResult } from "./centerline";
import { assessEmbroideryDetails } from "./detail-intelligence";

export type MachinePath = CenterlinePath & { sourceIndex: number; reversed: boolean };
export type TravelMove = { from: CenterlinePoint; to: CenterlinePoint; distanceMm: number; trim: boolean };
export type StitchBridge = { from: CenterlinePoint; to: CenterlinePoint; distanceMm: number; reason: "proximity" | "artwork"; artworkCoverage: number };
export type MachinePlan = {
  paths: MachinePath[];
  jumps: TravelMove[];
  bridges: StitchBridge[];
  trimCount: number;
  totalJumpMm: number;
  bridgeThreadMm: number;
  trimThresholdMm: number;
  bridgeThresholdMm: number;
  artworkBridgeMaxMm: number;
  artworkCoverageThreshold: number;
  artworkBridgeCount: number;
  consolidatedBlocks: number;
  sourcePathCount: number;
  cleanedPathCount: number;
  removedDetailCount: number;
  simplifiedDetailCount: number;
  routeScore: number;
  routeCandidatesTested: number;
  clusterCount: number;
  clusterTransitions: number;
  clusterRadiusMm: number;
};

type RouteBuild = { paths: MachinePath[]; jumps: TravelMove[]; bridges: StitchBridge[]; score: number };

type Cluster = { indices: number[]; center: CenterlinePoint };

function distance(a: CenterlinePoint, b: CenterlinePoint) { return Math.hypot(b.x - a.x, b.y - a.y); }
function vectorPathLength(points: CenterlinePoint[]) { let total=0; for(let i=1;i<points.length;i++) total+=distance(points[i-1],points[i]); return total; }
function resampleVector(points: CenterlinePoint[], spacingVector: number) {
  if(points.length<2||spacingVector<=0)return [...points]; const result:CenterlinePoint[]=[points[0]]; let carry=0;
  for(let i=1;i<points.length;i++){let ax=points[i-1].x,ay=points[i-1].y;const bx=points[i].x,by=points[i].y;let segment=Math.hypot(bx-ax,by-ay);while(segment+carry>=spacingVector&&segment>0){const needed=spacingVector-carry,t=needed/segment;ax+=(bx-ax)*t;ay+=(by-ay)*t;result.push({x:ax,y:ay});segment=Math.hypot(bx-ax,by-ay);carry=0}carry+=segment}
  const last=points[points.length-1],tail=result[result.length-1];if(distance(last,tail)>spacingVector*.35)result.push(last);return result;
}
function cleanedSourcePaths(centerlines:CenterlineResult,mmPerVectorUnit:number){const intelligence=assessEmbroideryDetails(centerlines);if(!intelligence)return{paths:centerlines.paths,removed:0,simplified:0};const spacingVector=centerlines.stitchLengthMm/Math.max(mmPerVectorUnit,.000001),paths:CenterlinePath[]=[];for(const detail of intelligence.details){if(detail.decision==="remove")continue;const original=centerlines.paths[detail.index],points=detail.decision==="simplify"?detail.simplifiedPoints:original.points,lengthVector=vectorPathLength(points),lengthMm=lengthVector*mmPerVectorUnit,stitches=resampleVector(points,spacingVector);if(points.length>=2&&stitches.length>=2)paths.push({points:[...points],stitches,lengthMm})}return{paths,removed:intelligence.remove,simplified:intelligence.simplify}}
function reversePath(path:CenterlinePath,sourceIndex:number):MachinePath{return{...path,sourceIndex,reversed:true,points:[...path.points].reverse(),stitches:[...path.stitches].reverse()}}
function forwardPath(path:CenterlinePath,sourceIndex:number):MachinePath{return{...path,sourceIndex,reversed:false,points:[...path.points],stitches:[...path.stitches]}}
function oriented(path:CenterlinePath,index:number,reverse:boolean){return reverse?reversePath(path,index):forwardPath(path,index)}
function firstPoint(path:CenterlinePath){return path.stitches[0]??path.points[0]}
function lastPoint(path:CenterlinePath){return path.stitches[path.stitches.length-1]??path.points[path.points.length-1]}
function unitVector(from:CenterlinePoint,to:CenterlinePoint){const dx=to.x-from.x,dy=to.y-from.y,length=Math.hypot(dx,dy);return length>0?{x:dx/length,y:dy/length}:null}
function exitDirection(path:CenterlinePath){const p=path.stitches.length>=2?path.stitches:path.points;return p.length>=2?unitVector(p[p.length-2],p[p.length-1]):null}
function entryDirection(path:CenterlinePath){const p=path.stitches.length>=2?path.stitches:path.points;return p.length>=2?unitVector(p[0],p[1]):null}
function bridgeIsCoherent(current:CenterlinePath,next:CenterlinePath){const bridge=unitVector(lastPoint(current),firstPoint(next));if(!bridge)return true;const outgoing=exitDirection(current),incoming=entryDirection(next),minDot=-.15,outDot=outgoing?outgoing.x*bridge.x+outgoing.y*bridge.y:1,inDot=incoming?incoming.x*bridge.x+incoming.y*bridge.y:1;return outDot>=minDot&&inDot>=minDot}
function maskHit(centerlines:CenterlineResult,point:CenterlinePoint,radius=1){const[minX,minY,width,height]=centerlines.viewBox,px=Math.round(((point.x-minX)/width)*(centerlines.rasterWidth-1)),py=Math.round(((point.y-minY)/height)*(centerlines.rasterHeight-1));for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){const x=px+dx,y=py+dy;if(x<0||y<0||x>=centerlines.rasterWidth||y>=centerlines.rasterHeight)continue;if(centerlines.artworkMask[y*centerlines.rasterWidth+x])return true}return false}
function artworkCoverage(centerlines:CenterlineResult,from:CenterlinePoint,to:CenterlinePoint){const pixelDistance=Math.hypot(((to.x-from.x)/centerlines.viewBox[2])*centerlines.rasterWidth,((to.y-from.y)/centerlines.viewBox[3])*centerlines.rasterHeight),samples=Math.max(5,Math.ceil(pixelDistance*1.4));let supported=0;for(let step=0;step<=samples;step++){const t=step/samples,point={x:from.x+(to.x-from.x)*t,y:from.y+(to.y-from.y)*t};if(maskHit(centerlines,point,1))supported++}return supported/(samples+1)}
function transition(centerlines:CenterlineResult,current:MachinePath,next:MachinePath,mmPerVectorUnit:number,trimThresholdMm:number,bridgeThresholdMm:number,artworkBridgeMaxMm:number,artworkCoverageThreshold:number){const from=lastPoint(current),to=firstPoint(next),moveMm=distance(from,to)*mmPerVectorUnit,coherent=bridgeIsCoherent(current,next),coverage=moveMm<=artworkBridgeMaxMm?artworkCoverage(centerlines,from,to):0,proximityBridge=coherent&&moveMm<=bridgeThresholdMm,artworkBridge=coherent&&moveMm>bridgeThresholdMm&&moveMm<=artworkBridgeMaxMm&&coverage>=artworkCoverageThreshold;if(proximityBridge||artworkBridge)return{bridge:{from,to,distanceMm:moveMm,reason:artworkBridge?"artwork" as const:"proximity" as const,artworkCoverage:coverage},jump:null};return{bridge:null,jump:{from,to,distanceMm:moveMm,trim:moveMm>=trimThresholdMm}}}

function pathCenter(path:CenterlinePath){const points=path.points.length?path.points:path.stitches;let x=0,y=0;for(const p of points){x+=p.x;y+=p.y}return{x:x/Math.max(1,points.length),y:y/Math.max(1,points.length)}}
function buildClusters(source:CenterlinePath[],mmPerVectorUnit:number,clusterRadiusMm:number):Cluster[]{
  const centers=source.map(pathCenter),parent=source.map((_,i)=>i);
  const find=(i:number):number=>parent[i]===i?i:(parent[i]=find(parent[i]));
  const join=(a:number,b:number)=>{const ra=find(a),rb=find(b);if(ra!==rb)parent[rb]=ra};
  for(let i=0;i<source.length;i++)for(let j=i+1;j<source.length;j++)if(distance(centers[i],centers[j])*mmPerVectorUnit<=clusterRadiusMm)join(i,j);
  const groups=new Map<number,number[]>();for(let i=0;i<source.length;i++){const root=find(i),list=groups.get(root)??[];list.push(i);groups.set(root,list)}
  return [...groups.values()].map(indices=>{let x=0,y=0;for(const i of indices){x+=centers[i].x;y+=centers[i].y}return{indices,center:{x:x/indices.length,y:y/indices.length}}});
}
function nearestClusterOrder(clusters:Cluster[]){if(clusters.length<=1)return clusters.map((_,i)=>i);const remaining=new Set(clusters.map((_,i)=>i));let current=[...remaining].sort((a,b)=>clusters[a].center.y-clusters[b].center.y||clusters[a].center.x-clusters[b].center.x)[0];const order=[current];remaining.delete(current);while(remaining.size){let best=-1,bestDistance=Infinity;for(const i of remaining){const d=distance(clusters[current].center,clusters[i].center);if(d<bestDistance){bestDistance=d;best=i}}if(best<0)break;order.push(best);remaining.delete(best);current=best}return order}
function nextLookaheadDistance(source:CenterlinePath[],remaining:Set<number>,candidateIndex:number,candidateReverse:boolean){if(remaining.size<=1)return 0;const candidate=oriented(source[candidateIndex],candidateIndex,candidateReverse),end=lastPoint(candidate);let best=Infinity;for(const index of remaining){if(index===candidateIndex)continue;best=Math.min(best,distance(end,firstPoint(source[index])),distance(end,lastPoint(source[index])))}return Number.isFinite(best)?best:0}
function buildClusterOrder(source:CenterlinePath[],clusterIndices:number[],entryPoint:CenterlinePoint|null,mmPerVectorUnit:number,trimThresholdMm:number){
  const remaining=new Set(clusterIndices),ordered:MachinePath[]=[];let current:MachinePath|null=null;
  while(remaining.size){let bestIndex=-1,bestReverse=false,bestScore=Infinity;for(const index of remaining){for(const reverse of [false,true]){const next=oriented(source[index],index,reverse),moveMm=(current?distance(lastPoint(current),firstPoint(next)):entryPoint?distance(entryPoint,firstPoint(next)):0)*mmPerVectorUnit,lookaheadMm=nextLookaheadDistance(source,remaining,index,reverse)*mmPerVectorUnit,trimPenalty=moveMm>=trimThresholdMm?2.5:0,score=moveMm+lookaheadMm*.32+trimPenalty;if(score<bestScore){bestScore=score;bestIndex=index;bestReverse=reverse}}}if(bestIndex<0)break;current=oriented(source[bestIndex],bestIndex,bestReverse);ordered.push(current);remaining.delete(bestIndex)}return ordered;
}
function buildZoneAwareOrder(source:CenterlinePath[],clusters:Cluster[],mmPerVectorUnit:number,trimThresholdMm:number){const clusterOrder=nearestClusterOrder(clusters),ordered:MachinePath[]=[];let entry:CenterlinePoint|null=null;for(const clusterIndex of clusterOrder){const local=buildClusterOrder(source,clusters[clusterIndex].indices,entry,mmPerVectorUnit,trimThresholdMm);ordered.push(...local);if(local.length)entry=lastPoint(local[local.length-1])}return ordered}
function evaluateOrder(centerlines:CenterlineResult,ordered:MachinePath[],mmPerVectorUnit:number,trimThresholdMm:number,bridgeThresholdMm:number,artworkBridgeMaxMm:number,artworkCoverageThreshold:number):RouteBuild{const jumps:TravelMove[]=[],bridges:StitchBridge[]=[];for(let i=1;i<ordered.length;i++){const move=transition(centerlines,ordered[i-1],ordered[i],mmPerVectorUnit,trimThresholdMm,bridgeThresholdMm,artworkBridgeMaxMm,artworkCoverageThreshold);if(move.bridge)bridges.push(move.bridge);if(move.jump)jumps.push(move.jump)}const trimCount=jumps.filter(j=>j.trim).length,totalJumpMm=jumps.reduce((s,j)=>s+j.distanceMm,0),bridgeThreadMm=bridges.reduce((s,b)=>s+b.distanceMm,0);const score=totalJumpMm+trimCount*4+jumps.length*.8+bridgeThreadMm*.05;return{paths:ordered,jumps,bridges,score}}

export function buildMachinePlan(centerlines:CenterlineResult|null,targetWidthMm:number,vectorWidth:number,trimThresholdMm=3,bridgeThresholdMm=1.25,artworkBridgeMaxMm=3.5,artworkCoverageThreshold=.72):MachinePlan|null{
  if(!centerlines?.paths.length||targetWidthMm<=0||vectorWidth<=0)return null;const mmPerVectorUnit=targetWidthMm/vectorWidth,cleaned=cleanedSourcePaths(centerlines,mmPerVectorUnit),source=cleaned.paths.filter(path=>firstPoint(path)&&lastPoint(path));if(!source.length)return null;
  const clusterRadiusMm=Math.max(7,Math.min(12,targetWidthMm*.12)),clusters=buildClusters(source,mmPerVectorUnit,clusterRadiusMm);const candidates:number[]=[clusterRadiusMm,clusterRadiusMm*.82,clusterRadiusMm*1.18];let best:RouteBuild|null=null,bestClusterCount=clusters.length,tested=0;
  for(const radius of candidates){const trialClusters=buildClusters(source,mmPerVectorUnit,radius),ordered=buildZoneAwareOrder(source,trialClusters,mmPerVectorUnit,trimThresholdMm),evaluated=evaluateOrder(centerlines,ordered,mmPerVectorUnit,trimThresholdMm,bridgeThresholdMm,artworkBridgeMaxMm,artworkCoverageThreshold);tested++;if(!best||evaluated.score<best.score){best=evaluated;bestClusterCount=trialClusters.length}}
  if(!best)return null;const trimCount=best.jumps.filter(j=>j.trim).length,totalJumpMm=best.jumps.reduce((s,j)=>s+j.distanceMm,0),bridgeThreadMm=best.bridges.reduce((s,b)=>s+b.distanceMm,0);
  return{paths:best.paths,jumps:best.jumps,bridges:best.bridges,trimCount,totalJumpMm,bridgeThreadMm,trimThresholdMm,bridgeThresholdMm,artworkBridgeMaxMm,artworkCoverageThreshold,artworkBridgeCount:best.bridges.filter(b=>b.reason==="artwork").length,consolidatedBlocks:Math.max(1,best.paths.length-best.bridges.length),sourcePathCount:centerlines.paths.length,cleanedPathCount:source.length,removedDetailCount:cleaned.removed,simplifiedDetailCount:cleaned.simplified,routeScore:best.score,routeCandidatesTested:tested,clusterCount:bestClusterCount,clusterTransitions:Math.max(0,bestClusterCount-1),clusterRadiusMm};
}
