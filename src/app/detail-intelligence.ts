import type { CenterlineResult } from "./centerline";

export type DetailDecision = "keep" | "simplify" | "remove";
export type DetailAssessment = { index:number;decision:DetailDecision;score:number;lengthMm:number;needlePoints:number;reason:string };
export type DetailIntelligence = { details:DetailAssessment[];keep:number;simplify:number;remove:number;retainedLengthMm:number };

export function assessEmbroideryDetails(result: CenterlineResult | null): DetailIntelligence | null {
  if (!result) return null;
  const details = result.paths.map<DetailAssessment>((path,index) => {
    const length=path.lengthMm, needlePoints=path.stitches.length;
    let score=100;
    if(length<1.5) score-=75; else if(length<2.5) score-=48; else if(length<4) score-=24;
    if(needlePoints<=2) score-=22; else if(needlePoints===3) score-=8;
    score=Math.max(0,Math.min(100,score));
    let decision:DetailDecision="keep",reason="Long enough to preserve as a distinct embroidered detail.";
    if(score<38){decision="remove";reason=`Only ${length.toFixed(1)} mm long with ${needlePoints} needle point${needlePoints===1?"":"s"}; likely to read as thread noise.`}
    else if(score<72){decision="simplify";reason=`Small ${length.toFixed(1)} mm detail; preserve the idea with a cleaner mark.`}
    return{index,decision,score,lengthMm:length,needlePoints,reason};
  });
  return{details,keep:details.filter(d=>d.decision==="keep").length,simplify:details.filter(d=>d.decision==="simplify").length,remove:details.filter(d=>d.decision==="remove").length,retainedLengthMm:details.filter(d=>d.decision!=="remove").reduce((sum,d)=>sum+d.lengthMm,0)};
}
