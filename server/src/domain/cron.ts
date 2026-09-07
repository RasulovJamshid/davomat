const matches=(value:number,expression:string)=>expression==="*"||(expression.startsWith("*/")&&value%Number(expression.slice(2))===0)||expression.split(",").map(Number).includes(value);
export function nextCronRun(cron:string,after=new Date()):Date{
  const parts=cron.trim().split(/\s+/);if(parts.length!==5)throw new Error("Cron must contain five fields");
  const candidate=new Date(after);candidate.setUTCSeconds(0,0);candidate.setUTCMinutes(candidate.getUTCMinutes()+1);
  for(let i=0;i<527040;i++,candidate.setUTCMinutes(candidate.getUTCMinutes()+1)){
    if(matches(candidate.getUTCMinutes(),parts[0])&&matches(candidate.getUTCHours(),parts[1])&&matches(candidate.getUTCDate(),parts[2])&&matches(candidate.getUTCMonth()+1,parts[3])&&matches(candidate.getUTCDay(),parts[4]))return new Date(candidate);
  }throw new Error("Cron does not produce a run within one year");
}
