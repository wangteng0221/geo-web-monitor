import {compareMonitorConditions} from './monitor-conditions.js';
import {brandEvidence, brandMatches} from './brand-evidence.js';
import {citationHost, webHost} from './web-url.js';

const brandMentioned=(text,brand)=>brandMatches(text,brand).length>0;
const linkItems=value=>Array.isArray(value)?value.map(item=>typeof item==='string'?{url:item,title:item}:item).filter(Boolean):[];

export function brandWebHost(value) {
  const text=String(value||'').trim();
  if(!text||/\s|\\|@/.test(text)) return null;
  if(/^https?:\/\//i.test(text)) return webHost(text);
  // Accept a domain entered in the brand form, never repair collected URLs.
  if(text.includes('://')||text.startsWith('//')||/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(text)) return null;
  try {
    const parsed=new URL('https://'+text);
    if(parsed.username||parsed.password||!parsed.hostname.includes('.')||parsed.hostname.split('.').some(p=>!p||p.startsWith('-')||p.endsWith('-'))) return null;
    return webHost(parsed.href);
  } catch {return null;}
}
export function prepareReportRecord(e) {
  const originalStatus=e.status;
  const emptyAnswer=e.status==='succeeded'&&!String(e.answer||'').trim();
  const slotMismatch=Boolean(e.slotMismatch);
  const unusable=emptyAnswer||slotMismatch;
  const status=unusable?'unusable':e.status;
  const rawCitations=linkItems(e.citations);
  const rawSearchResults=linkItems(e.searchedSites);
  const citations=rawCitations.filter(c=>c&&webHost(c.url));
  const searchedSites=rawSearchResults.filter(c=>c&&webHost(c.url));
  const identities=new Set(citations.map(c=>c.number?String(c.number):c.url));
  const numberedUrls=new Map();
  let conflictingNumber=false;
  for(const c of citations) if(c.number) {
    const number=String(c.number);
    if(numberedUrls.has(number)&&numberedUrls.get(number)!==c.url) conflictingNumber=true;
    numberedUrls.set(number,c.url);
  }
  const discardedCitationCount=rawCitations.length-citations.length;
  const expected=e.reportedCitationCount??null;
  let citationCompleteness='unknown';
  if(discardedCitationCount||conflictingNumber) citationCompleteness='inconsistent';
  else if(e.citationGap) citationCompleteness='partial';
  else if(Number.isInteger(expected)&&expected>=0) {
    citationCompleteness=identities.size===expected?'complete':identities.size<expected?'partial':'inconsistent';
  }
  const searchIdentities=new Set(searchedSites.map(c=>c.number?String(c.number):c.url));
  const discardedSearchCount=rawSearchResults.length-searchedSites.length;
  const reportedSearchCount=e.reportedSearchCount??null;
  let searchCompleteness='unknown';
  if(discardedSearchCount) searchCompleteness='inconsistent';
  else if(Number.isInteger(reportedSearchCount)&&reportedSearchCount>=0) {
    searchCompleteness=searchIdentities.size===reportedSearchCount?'complete':searchIdentities.size<reportedSearchCount?'partial':'inconsistent';
  }
  const own=brandWebHost(e.brand?.website);
  const found=own&&citations.some(c=>{const host=webHost(c.url);return host===own||host.endsWith('.'+own);});
  // A visible matching link proves presence, even if other links are missing.
  // Absence is only classified when the visible reference count reconciles.
  const ownCitation=own?(found?true:citationCompleteness==='complete'?false:null):null;
  const ownCitationReason=own?null:'官网未配置或格式无效';
  const unknownOwnReason=own&&ownCitation===null?(citationCompleteness==='unknown'?'引用总数未知':'引用证据不完整'):null;
  const conditionsState=compareMonitorConditions(e.monitorConditions,e.conditionsAfter);
  const conditionsChanged=conditionsState==='different';
  const qualityFlags=[];
  if(emptyAnswer) qualityFlags.push({code:'empty_answer',severity:'review',message:'记录标为成功，但回答正文为空。'});
  if(slotMismatch) qualityFlags.push({code:'slot_mismatch',severity:'review',message:'问题、账号或平台与运行快照不匹配。'});
  else if(e.slotIntegrityKnown===false) qualityFlags.push({code:'slot_integrity_unknown',severity:'info',message:'历史运行缺少完整任务快照，无法核对问题和账号归属。'});
  if(e.duplicateSlot) qualityFlags.push({code:'duplicate_slot',severity:'review',message:'同一运行的问题、平台和账号存在重复记录。'});
  if(status==='succeeded'&&(e.screenshotAvailable===false||!e.screenshot)) qualityFlags.push({code:'screenshot_missing',severity:'review',message:'缺少采集截图，原网页证据不完整。'});
  if(citationCompleteness==='partial') qualityFlags.push({code:'citation_partial',severity:'review',message:'已采集引用少于页面标注数量。'});
  if(citationCompleteness==='inconsistent') qualityFlags.push({code:'citation_inconsistent',severity:'review',message:'引用链接、编号或页面标注数量互相冲突。'});
  if(citationCompleteness==='unknown'&&status==='succeeded') qualityFlags.push({code:'citation_unknown',severity:'info',message:'平台未提供可核对的引用总数。'});
  if(searchCompleteness==='partial'||searchCompleteness==='inconsistent') qualityFlags.push({code:'search_incomplete',severity:'review',message:'搜索结果数量与已取得链接不一致。'});
  if(searchCompleteness==='unknown'&&status==='succeeded') qualityFlags.push({code:'search_unknown',severity:'info',message:'平台未提供可核对的搜索结果总数。'});
  if(conditionsChanged) qualityFlags.push({code:'conditions_changed',severity:'review',message:'采集前后监测条件发生变化。'});
  else if(conditionsState==='unknown') qualityFlags.push({code:'conditions_unknown',severity:'info',message:'监测条件未完整记录，不能确认同条件对比。'});
  if(e.brandBasis==='current_fallback') qualityFlags.push({code:'brand_snapshot_missing',severity:'info',message:'历史品牌快照缺失，名称匹配按当前资料补算。'});
  const reviewRequired=qualityFlags.some(flag=>flag.severity==='review');
  return {...e,originalStatus,status,citations,searchedSites,unusable,nameEvidence:status==='succeeded'?brandEvidence({...e,citations}):null,
    conditionsChanged,conditionsState,citationCompleteness,searchCompleteness,ownWebsiteConfigured:Boolean(own),ownCitationReason,unknownOwnReason,
    screenshotAvailable:e.screenshotAvailable??(Boolean(e.screenshot)),
    error:emptyAnswer?'记录标为成功，但回答正文为空；未纳入有效回答统计。':slotMismatch?'记录与运行快照不匹配；未纳入有效回答统计。':e.error,
    eligible:e.kind==='discovery'&&!brandMentioned(e.question,e.brand),
    mentioned:status==='succeeded'&&brandMentioned(e.answer,e.brand),
    citationGap:['partial','inconsistent'].includes(citationCompleteness),ownCitation,
    discardedCitationCount,discardedSearchCount,
    quality:{status:reviewRequired?'review':qualityFlags.length?'limited':'ok',reviewRequired,flags:qualityFlags}};
}

export function prepareReportRecords(entries) {
  const prepared=entries.map(prepareReportRecord);
  const slotCounts=new Map();
  for(const e of prepared) if(e.account_id) {
    const key=JSON.stringify([e.run_id,e.question_id,e.platform,e.account_id]);
    slotCounts.set(key,(slotCounts.get(key)||0)+1);
  }
  let duplicateRecords=0;
  for(const e of prepared) if(e.account_id&&slotCounts.get(JSON.stringify([e.run_id,e.question_id,e.platform,e.account_id]))>1) {
    duplicateRecords++;
    e.duplicateSlot=true;
    if(e.status==='succeeded') {
      e.status='unusable';e.unusable=true;e.mentioned=false;
      e.error='同一运行的问题、平台和账号存在重复记录；未纳入有效回答统计。';
      e.quality={status:'review',reviewRequired:true,flags:[...(e.quality?.flags||[]),{code:'duplicate_slot',severity:'review',message:'同一运行的问题、平台和账号存在重复记录。'}]};
    }
  }
  return {records:prepared,duplicateRecords};
}

export function summarizeRecords(list) {
  const good=list.filter(e=>e.status==='succeeded');
  const eligible=good.filter(e=>e.eligible), mentions=eligible.filter(e=>e.mentioned);
  const own=good.filter(e=>e.mentioned&&e.ownCitation!==null);
  const count=key=>list.filter(e=>e.status===key).length;
  const ratio=(a,b)=>b?a/b:null;
  const citation={complete:good.filter(e=>e.citationCompleteness==='complete').length,partial:good.filter(e=>e.citationCompleteness==='partial').length,
    unknown:good.filter(e=>e.citationCompleteness==='unknown').length,inconsistent:good.filter(e=>e.citationCompleteness==='inconsistent').length};
  const search={complete:good.filter(e=>e.searchCompleteness==='complete').length,partial:good.filter(e=>e.searchCompleteness==='partial').length,
    unknown:good.filter(e=>e.searchCompleteness==='unknown').length,inconsistent:good.filter(e=>e.searchCompleteness==='inconsistent').length};
  const conditions={same:good.filter(e=>e.conditionsState==='same').length,different:good.filter(e=>e.conditionsState==='different').length,
    unknown:good.filter(e=>e.conditionsState==='unknown').length};
  return {total:list.length,successful:good.length,failed:count('failed'),invalid:count('unusable'),
    pending:list.filter(e=>!['succeeded','failed','unusable'].includes(e.status)).length,
    eligible:eligible.length,mentions:mentions.length,mentionRate:ratio(mentions.length,eligible.length),
    nameMentions:good.filter(e=>e.mentioned).length,
    ownSourceEligible:own.length,ownSourceAnswers:own.filter(e=>e.ownCitation).length,
    ownSourceRate:ratio(own.filter(e=>e.ownCitation).length,own.length),ownSourceUnknown:good.filter(e=>e.mentioned&&e.ownCitation===null).length,
    ownSourceUnknownNoWebsite:good.filter(e=>e.mentioned&&e.ownCitation===null&&!e.ownWebsiteConfigured).length,
    ownSourceUnknownEvidence:good.filter(e=>e.mentioned&&e.ownCitation===null&&e.ownWebsiteConfigured).length,
    captureRate:ratio(good.length,list.length),cited:good.filter(e=>e.citations.length).length,citedRate:ratio(good.filter(e=>e.citations.length).length,good.length),
    citation,search,conditions,screenshotMissing:good.filter(e=>e.screenshotAvailable===false||!e.screenshot).length,
    reviewRequired:list.filter(e=>e.quality?.reviewRequired).length};
}
