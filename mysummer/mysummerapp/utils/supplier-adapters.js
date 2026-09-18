const mock=require('./mock-supplier-adapter')
const adapters=[mock]
function enabled(){return adapters.slice()}
function searchSync(demand,context){return enabled().flatMap(a=>typeof a.searchSync==='function'?a.searchSync(demand,context):[]).map(q=>Object.assign({},q,{adapterId:q.adapterId||q.provider}))}
async function search(demand,context){const groups=await Promise.all(enabled().map(a=>a.search(demand,context)));return groups.flat().map(q=>Object.assign({},q,{adapterId:q.adapterId||q.provider}))}
function choose(candidates,demand,goal){
  const now=Date.now()
  const valid=candidates.filter(q=>q.status==='available'&&q.availability>=(demand.quantity||1)&&new Date(q.expiresAt).getTime()>now)
  if(!valid.length)return null
  if(!goal)return valid[0]
  return valid.slice().sort((a,b)=>{
    if(goal==='保留时间更换推荐')return (a.start||'').localeCompare(b.start||'')||a.unitPrice-b.unitPrice
    return a.unitPrice-b.unitPrice
  })[0]
}
function adapterFor(quote){return enabled().find(a=>a.id===(quote.adapterId||quote.provider))}
function revalidate(quote,context){const adapter=adapterFor(quote);if(!adapter)return Promise.resolve({available:false,status:'adapter_missing',checkedAt:new Date().toISOString(),message:'报价来源适配器不可用，请重新规划'});return adapter.revalidate(quote,context)}
function summary(){return enabled().map(a=>({id:a.id,name:a.name,isDemo:!!a.isDemo}))}
module.exports={searchSync,search,choose,revalidate,summary}
