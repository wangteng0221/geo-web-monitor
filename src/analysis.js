import { brandMatches } from './brand-evidence.js';
import { prepareReportRecords, summarizeRecords } from './report-policy.js';
import { citationHost } from './web-url.js';

export { citationHost } from './web-url.js';

function normalized(text) {
  return String(text ?? '').toLocaleLowerCase().replace(/\s+/g, '');
}

export function brandMentioned(answer, brand) {
  return brandMatches(answer, brand).length > 0;
}

// Kept for older API consumers. This heuristic is not used by decision UI.
export function sentimentGuess(answer, brand) {
  if (!brandMentioned(answer, brand)) return 'not_applicable';
  const text = normalized(answer);
  const negative = ['不推荐', '不适合', '差评', '投诉', '风险', '缺点', '争议', '问题较多'];
  const positive = ['推荐', '适合', '优势', '值得', '可靠', '表现不错', '口碑较好'];
  const hasNegative = negative.some(word => text.includes(word));
  const withoutNegations = negative.reduce((value, word) => value.replaceAll(word, ''), text);
  const hasPositive = positive.some(word => withoutNegations.includes(word));
  if (hasNegative && hasPositive) return 'mixed';
  if (hasNegative) return 'negative';
  if (hasPositive) return 'positive';
  return 'neutral';
}

function parseArray(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value || '[]') : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function summarizeRun({ brand, questions, results, totalExpected = results.length }) {
  const byId = new Map(questions.map(q => [Number(q.id), q]));
  const entries = results.map((r, index) => {
    const question = byId.get(Number(r.question_id));
    let diagnostics = {};
    try { diagnostics = JSON.parse(r.diagnostics_json || '{}') || {}; } catch {}
    return {
      key: String(r.id ?? index), run_id: r.run_id ?? 1,
      question_id: Number(r.question_id), question: question?.text || r.question || '', kind: question?.kind || r.kind,
      platform: r.platform || 'unknown', account_id: r.account_id ?? null,
      account_label: r.account_label || '默认账号', status: r.status, answer: r.answer || '', brand,
      citations: parseArray(r.citations_json ?? r.citations),
      searchedSites: parseArray(r.searched_sites_json ?? r.searchedSites),
      reportedCitationCount: r.reported_citation_count ?? r.reportedCitationCount ?? null,
      reportedSearchCount: r.reported_search_count ?? r.reportedSearchCount ?? null,
      screenshot: r.screenshot || null,screenshotAvailable:r.screenshotAvailable,
      slotMismatch:r.slotMismatch,slotIntegrityKnown:r.slotIntegrityKnown,
      monitorConditions: diagnostics.monitorConditions || r.monitorConditions || null,
      conditionsAfter: diagnostics.conditionsAfter || r.conditionsAfter || null,
    };
  });
  const { records, duplicateRecords } = prepareReportRecords(entries);
  const recordSummary = summarizeRecords(records);
  const successfulRecords = records.filter(r => r.status === 'succeeded');
  const discovery = successfulRecords.filter(r => r.eligible);
  const mentions = discovery.filter(r => r.mentioned);
  const mismatch = results.length > totalExpected;
  const successful = successfulRecords.length;
  const failed = recordSummary.failed;
  const invalid = recordSummary.invalid;
  const pending = Math.max(recordSummary.pending, Math.max(0, totalExpected - successful - failed - invalid));
  const captureRate = totalExpected > 0 && !mismatch ? successful / totalExpected : null;
  const citationGaps = recordSummary.citation.partial + recordSummary.citation.inconsistent;
  const searchGaps = recordSummary.search.partial + recordSummary.search.inconsistent;
  const qualityWarnings = [
    ...(invalid ? [`有 ${invalid} 条记录正文为空、归属重复或与运行快照不匹配，未纳入有效回答。`] : []),
    ...(mismatch ? ['保存记录超过预期数量，暂不计算采集覆盖率。'] : []),
    ...(pending ? [`还有 ${pending} 条待处理或未定位样本，当前报告不是完整批次。`] : []),
    ...(failed ? [`有 ${failed} 条采集失败；品牌名称出现率只统计有效回答。`] : []),
    ...(citationGaps ? [`有 ${citationGaps} 条回答的引用数量有缺口或不一致；来源统计只展示已取得的有效链接。`] : []),
    ...(recordSummary.citation.unknown ? [`有 ${recordSummary.citation.unknown} 条有效回答的引用总数未知；官网未出现在已取得链接中时不能直接判断为未引用。`] : []),
    ...(searchGaps ? [`有 ${searchGaps} 条回答的搜索结果数量有缺口或不一致。`] : []),
    ...(recordSummary.screenshotMissing ? [`有 ${recordSummary.screenshotMissing} 条有效回答缺少采集截图。`] : []),
    ...(recordSummary.conditions.unknown ? [`有 ${recordSummary.conditions.unknown} 条有效回答的监测条件未完整记录，不能确认同条件对比。`] : []),
    ...(discovery.length < 3 ? ['无品牌名推荐问题的有效回答少于 3 条，品牌名称出现率仅描述当前样本。'] : []),
  ];

  const accounts = new Map();
  for (const record of records) {
    const key = record.account_id ? String(record.account_id) : `${record.platform}:default`;
    if (!accounts.has(key)) accounts.set(key, []);
    accounts.get(key).push(record);
  }
  const byAccount = [...accounts.values()].map(list => {
    const s = summarizeRecords(list);
    return { platform: list[0].platform, label: list[0].account_label || '默认账号',
      successful: s.successful, failed: s.failed, pending: s.pending, invalid: s.invalid,
      discoveryTotal: s.eligible, discoveryMentions: s.mentions,
      discoveryMentionRate: s.mentionRate };
  });

  const sentiment = { positive: 0, negative: 0, mixed: 0, neutral: 0 };
  const hosts = new Map();
  for (const record of successfulRecords) {
    const guess = sentimentGuess(record.answer, brand);
    if (guess in sentiment) sentiment[guess]++;
    for (const citation of record.citations) {
      const host = citationHost(citation?.url);
      if (host) hosts.set(host, (hosts.get(host) || 0) + 1);
    }
  }

  return {
    ...recordSummary,
    total: totalExpected, successful, failed, invalid, pending, captureRate,
    citationGaps, searchGaps, duplicateRecords, qualityWarnings,
    quality: { citation: recordSummary.citation, search: recordSummary.search,
      conditions: recordSummary.conditions, screenshotMissing: recordSummary.screenshotMissing,
      reviewRequired: recordSummary.reviewRequired, duplicateRecords },
    records,
    discoveryTotal: discovery.length,
    discoveryMentions: mentions.length,
    discoveryMentionRate: discovery.length ? mentions.length / discovery.length : null,
    byAccount,
    sentimentGuess: sentiment,
    topCitationHosts: [...hosts].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([host, count]) => ({ host, count })),
    caveats: [
      '品牌名称出现率仅统计成功采集且问题未包含品牌名的推荐类回答；名称出现不代表推荐或认可。',
      '引用和搜索来源只表示页面可见且已保存的链接，不证明链接可访问或内容真实。',
      '引用链接仅代表页面展示的来源，不自动证明回答中的说法正确。',
    ],
  };
}
