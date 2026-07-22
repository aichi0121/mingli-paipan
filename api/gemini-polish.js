const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
const MODEL_PREFERENCES = [DEFAULT_GEMINI_MODEL, 'gemini-3.1-flash-lite', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
let cachedGeminiModel = '';

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.ALLOWED_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function safeString(value, limit = 12000) {
  if (value == null) return '';
  if (typeof value === 'string') return value.slice(0, limit);
  return JSON.stringify(value).slice(0, limit);
}

function sanitizeGeminiOutput(text) {
  return String(text || '')
    .replace(/\*\*/g, '')
    .replace(/\n?\s*\*?\s*Wait,\s*let['’]s refine[\s\S]*$/i, '')
    .replace(/\n?\s*Interrupted text:[\s\S]*$/i, '')
    .replace(/\n?\s*My continuation:[\s\S]*$/i, '')
    .replace(/\n?\s*["“]?\s*\(?the end of system prompt[\s\S]*$/i, '')
    .trim();
}

function tryParseJson(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (_) {
      return null;
    }
  }
}

function createFallbackReport(tags) {
  const chart = tags?.chart || {};
  const domains = tags?.domains || {};
  const timing = tags?.timing || {};
  const luck = timing.currentLuck || {};
  const annual = timing.annual || {};
  const relationship = domains.relationship || {};
  return {
    summary: `這張盤以【${chart.dayMaster || '日主'}】與【${chart.strength?.label || '格局待判'}】為核心；原局有${domains.wealth?.count ?? 0}個財星、${domains.career?.officialCount ?? 0}個官星、${domains.career?.outputCount ?? 0}個食傷訊號。目前【${luck.ganzhi || ''}${luck.tenGod || ''}】大運遇上【${annual.ganzhi || ''}${annual.tenGod || ''}】流年，解讀時要把原局能力、十年環境與今年事件一起看。`,
    keywords: [
      { label: '核心命格', value: `${chart.dayMaster || '日主'}・${chart.strength?.label || '格局待判'}`, tone: 'identity' },
      { label: '事業結構', value: `${domains.career?.officialCount ?? 0}官星・${domains.career?.outputCount ?? 0}食傷`, tone: 'career' },
      { label: '財運結構', value: `${domains.wealth?.count ?? 0}財星・${domains.wealth?.robWealth ?? 0}劫財`, tone: 'wealth' },
      { label: '關係模式', value: `${relationship.spousePalace || '日支'}夫妻宮・${relationship.gender === '男' ? '妻星' : '夫星'}${relationship.spouseElement || ''}`, tone: 'relationship' },
      { label: '健康重點', value: domains.health?.dayMasterOrgans || '依五行調養', tone: 'health' },
      { label: `${annual.year || '流年'}主題`, value: `${annual.ganzhi || ''}${annual.tenGod || ''}・${luck.ganzhi || ''}${luck.tenGod || ''}`, tone: 'annual' }
    ],
    chapterSummaries: []
  };
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanChapterConclusion(value, { title = '', clientName = '' } = {}) {
  let text = sanitizeGeminiOutput(value)
    .replace(/<[^>]*>/g, ' ')
    .replace(/^[\s#>*\-•]+/gm, '')
    .replace(/[🌟🏛🔗⚖️🌀📅💰💼💕🏥📆🏠👶]+/gu, ' ')
    .replace(/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬]/g, ' ')
    .replace(/(?:現況定性|行動處方)\s*[：:]?/g, '')
    .replace(/(?:親愛的|嗨|您好)[^，。！？]{0,20}[，,：:]?/g, '')
    .replace(/從你的命盤來看[，,：:]?/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (title) text = text.replace(new RegExp(escapeRegExp(title), 'g'), '').trim();
  if (clientName) text = text.replace(new RegExp(escapeRegExp(clientName), 'g'), '').replace(/^[，,、：:\s]+/, '').trim();
  return text.replace(/(?:你的)?(?:命理)?(?:分析|解析|報告)[，,：:]?/g, '').replace(/^[：:，,、\s]+/, '').replace(/\s+/g, ' ').trim();
}

function normalizedForComparison(value) {
  return cleanChapterConclusion(value)
    .replace(/[\s，。！？；：、,.!?;:「」『』【】（）()\-／/]/g, '')
    .toLowerCase();
}

function chapterSourceText(rawChapter) {
  if (!rawChapter) return '';
  if (typeof rawChapter === 'string') return rawChapter;
  return [rawChapter.title, rawChapter.text, rawChapter.content, rawChapter.body, safeString(rawChapter)]
    .filter(Boolean)
    .join(' ');
}

function isCopiedOrCanned(value, rawChapter) {
  const text = normalizedForComparison(value);
  const source = normalizedForComparison(chapterSourceText(rawChapter));
  if (!text || text.length < 12) return true;
  const canned = [
    '前後階段會呈現不同的外在事件與內在累積',
    '需要和原局及大運一起判斷',
    '家庭背景工作節奏親密關係與長期成果各有不同作用',
    '命盤中的合與沖會讓',
    '流日適合用來安排',
    '空間調整以一至兩個最重要方位為主',
    '這不是單純的好或壞',
    '理解這個傾向之後',
    '熟悉你的人往往更能感受到',
    '這份氣質會自然流露'
  ].map(normalizedForComparison);
  if (canned.some((phrase) => text.includes(phrase))) return true;
  if (!source) return false;
  if (source.includes(text)) return true;
  const sampleLength = Math.min(18, text.length);
  for (let index = 0; index <= text.length - sampleLength; index += 4) {
    if (source.includes(text.slice(index, index + sampleLength))) return true;
  }
  return false;
}

function listText(values, fallback = '') {
  const items = [...new Set((Array.isArray(values) ? values : [values])
    .flatMap((value) => String(value || '').split(/[、,，/]/))
    .map((value) => value.trim())
    .filter(Boolean))];
  if (!items.length) return fallback;
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join('、')}與${items.at(-1)}`;
}

function tenGodLifeTheme(tenGod) {
  const value = String(tenGod || '');
  if (value.includes('印')) return '進修、證照、貴人與專業背書';
  if (value.includes('財')) return '客戶、現金流、定價與資源調度';
  if (/官|殺/.test(value)) return '責任、規則、職位與客戶要求';
  if (/食神|傷官|食傷/.test(value)) return '作品、表達、教學與專業輸出';
  if (/比肩|劫財|比劫/.test(value)) return '自主權、同儕競合與合作界線';
  return '目前最重要的生活課題';
}

function pillarSummary(pillars) {
  const areas = ['原生家庭', '現實環境與工作', '核心需求與親密關係', '晚輩、作品與長期成果'];
  return (Array.isArray(pillars) ? pillars : []).slice(0, 4).map((pillar, index) => {
    const label = pillar?.label || ['年柱', '月柱', '日柱', '時柱'][index];
    return `${label}【${pillar?.ganzhi || '未提供'}】連到${areas[index]}`;
  }).join('；');
}

function interactionSummary(interactions) {
  const items = (Array.isArray(interactions) ? interactions : [])
    .map((item) => cleanChapterConclusion(typeof item === 'string' ? item : safeString(item)))
    .filter(Boolean);
  return items.slice(0, 2).join('；');
}

function fengShuiSummary(intersections) {
  const items = (Array.isArray(intersections) ? intersections : []).slice(0, 2);
  if (!items.length) return '最適合你的兩個空間重點仍需依住宅方位定位';
  return items.map((item) => {
    const themes = listText(item?.themes, '個人重點');
    return `${item?.direction || '適合方位'}主掌${themes}`;
  }).join('；');
}

function decisionAwareFallbacks(tags) {
  const domains = tags?.domains || {};
  const career = domains.career?.decision || {};
  const wealth = domains.wealth?.decision || {};
  const relationship = domains.relationship?.decision || {};
  const careerType = String(career.type || '');
  const wealthType = String(wealth.type || '');
  const relationshipType = String(relationship.type || '');
  return {
    '⑦': {
      status: wealthType.includes('高單價')
        ? '你的收入成長不在衝量，而在提高專業服務的單價、可信度與收款品質。'
        : wealthType.includes('作品')
          ? '你的財路來自把作品、技術或內容做成可收費的產品，收入管道宜少而精。'
          : '你的財務優勢在於把現實資源整理成穩定收入，而不是追逐短期機會。',
      action: wealthType.includes('高單價')
        ? '先完成一份高單價服務方案，並把訂金、尾款、改稿與取消規則寫進合約。'
        : '保留一至兩項核心收費項目，為每項服務訂出價格、交付內容與收款節點。'
    },
    '⑧': {
      status: /接案|顧問|企劃/.test(careerType)
        ? '你更適合以個人專業與口碑承接複雜案件，不必靠擴大團隊或服從僵硬體制來證明能力。'
        : /創業|品牌/.test(careerType)
          ? '你適合掌握產品與決策主導權，把自己的方法做成品牌，而不是長期替別人的制度執行。'
          : '你在有公信力的平台中最能發揮，先借助制度與專業背書，再逐步提高自主權。',
      action: /接案|顧問|企劃/.test(careerType)
        ? '整理一項最能代表你的專業服務，補齊案例、流程與報價後再集中對外曝光。'
        : /創業|品牌/.test(careerType)
          ? '先用單一核心產品驗證市場，不在收入尚未穩定前擴編大量人力。'
          : '今年鎖定一項關鍵證照或代表作，利用平台資源建立可被辨識的專業位置。'
    },
    '⑨': {
      status: relationshipType.includes('戰友')
        ? '你要的是能一起處理現實生活、說到做到的伴侶，可靠度比表面浪漫更重要。'
        : relationshipType.includes('陪伴')
          ? '你在關係裡重視長期陪伴與生活穩定，會先觀察對方是否可靠再真正靠近。'
          : '你需要能交流想法又尊重彼此空間的關係，過度控制會快速消耗親密感。',
      action: '固定安排一次不處理工作與雜事的對話，把需求、界線與現實分工直接說清楚。'
    }
  };
}

function chapterStatusFallbacks(tags) {
  const chart = tags?.chart || {};
  const domains = tags?.domains || {};
  const timing = tags?.timing || {};
  const luck = timing.currentLuck || {};
  const annual = timing.annual || {};
  const relationship = domains.relationship || {};
  const children = domains.children || {};
  const health = domains.health || {};
  const wealth = domains.wealth || {};
  const career = domains.career || {};
  const interactions = interactionSummary(chart.stemBranchInteractions);
  const usefulElements = listText(chart.usefulElements, '能讓全盤恢復平衡的能量');
  const dominantElements = listText(health.dominantElements, '較旺的五行');
  const missingElements = listText(health.missingElements, '較缺的五行');
  const childRule = children.childStarRule || (children.gender === '男' ? '官星' : '作品與表達星');
  const pressure = health.controllingPressure || {};
  const pressureText = pressure.element
    ? `${pressure.element}對${pressure.targetElement || chart.dayMaster || '日主'}的壓力（原局${Number(pressure.count || 0)}個訊號）`
    : '忙碌期的身體消耗';
  const topDirections = fengShuiSummary(domains.fengShui?.topIntersections);
  return {
    '①': `你的核心是【${chart.dayMaster || '本命日主'}】（${chart.yinYang || '陰陽屬性依排盤'}），目前判為【${chart.strength?.label || '依全盤判定強弱'}】；做事風格會同時受到月令【${chart.strength?.monthBranch || '未提供'}${chart.strength?.monthElement || ''}】影響。`,
    '②': pillarSummary(chart.pillars) || '四柱資料需分別對照原生家庭、工作、親密關係與長期成果。',
    '③': interactions ? `盤中實際牽動以${interactions}最明顯，相關宮位遇事時容易彼此連動。` : '目前原局未抓到需要優先放大的合沖訊號，事件判斷以各宮位本身為主。',
    '④': chart.strength?.label?.includes('弱')
      ? '你不是能力不足，而是容易同時承接太多外界要求；先補足休息與支援，表現才會穩定。'
      : '你的自主性與承擔力很強，但能量過滿時容易固執或硬撐，需要有固定的輸出與放鬆出口。',
    '⑤': `【${luck.ganzhi || '目前'}】大運（${luck.ageRange || '目前十年'}）把${tenGodLifeTheme(luck.tenGod)}推到生活主軸；前半段偏外在事件，後半段逐步轉入環境與心理累積。`,
    '⑥': `${annual.year || '今年'}【${annual.ganzhi || '流年'}】帶來${tenGodLifeTheme(annual.tenGod)}；和【${luck.ganzhi || '目前大運'}】疊加後，最值得集中的是一項能留下成果的年度計畫。`,
    '⑦': domains.wealth?.decision ? `獲利模式是「${domains.wealth.decision.type}」：${domains.wealth.decision.path}。` : '收入機會與資金留存方式不同，需同時看賺錢能力與合作風險。',
    '⑧': domains.career?.decision ? `職涯定位是「${domains.career.decision.type}」：${domains.career.decision.reason}。` : '職涯適合集中在能累積專業成果、口碑與自主權的工作結構。',
    '⑨': domains.relationship?.decision ? `關係定位是「${domains.relationship.decision.type}」：${domains.relationship.decision.partner}。` : `關係中重視${relationship.spousePalace || '夫妻宮'}所代表的安全感、承諾與相處界線。`,
    '⑩': `${children.gender || '此命盤'}的判讀規則是「${childRule}」，原局抓到${children.childStarCount ?? 0}個子女訊號；作品另看${children.workStarRule || '專業輸出'}，目前有${children.workStarCount ?? children.outputCount ?? 0}個訊號，兩條線不混算。`,
    '⑪': `原局以${dominantElements}較突出、${missingElements}較需補位，壓力優先反映在${health.dayMasterOrgans || '睡眠與消化'}；${pressureText}是保養重點。`,
    '⑫': `得財日優先看【${wealth.element || '財星五行'}】，工作機會看【${career.officialElement || '官星五行'}】，關係互動看【${relationship.spouseElement || '配偶星五行'}】，健康則依${health.dayMasterOrgans || '本命臟腑'}調整節奏。`,
    '⑬': `${topDirections}；主章只保留這兩個交集，不必把所有方位與擺件同時啟動。`
  };
}

function chapterActionFallbacks(tags) {
  const chart = tags?.chart || {};
  const domains = tags?.domains || {};
  const timing = tags?.timing || {};
  const luck = timing.currentLuck || {};
  const annual = timing.annual || {};
  const children = domains.children || {};
  const health = domains.health || {};
  const usefulElements = listText(chart.usefulElements, '適合你的平衡方向');
  const positions = Array.isArray(domains.fengShui?.topIntersections) ? domains.fengShui.topIntersections : [];
  const firstDirection = positions[0]?.direction || '最重要的交集方位';
  const secondDirection = positions[1]?.direction || '';
  return {
    '①': chart.strength?.label?.includes('弱')
      ? '先刪減一項不必要的責任，保留固定休息與求助空間，再承接新的任務。'
      : '每週安排一個能輸出成果的節點，避免把強大的承擔力變成硬撐與控制。',
    '②': '遇到問題時先確認它屬於家庭、工作、伴侶還是長期成果，再用該宮位的角色處理，不把所有責任混在一起。',
    '③': interactionSummary(chart.stemBranchInteractions)
      ? '牽涉到合沖對應的兩個生活領域時，把分工、期限與界線先說清楚再承諾。'
      : '目前不必為了尋找合沖而放大焦慮，先依四柱各自的現實事件判斷。',
    '④': `生活與工作決策可優先運用${usefulElements}所代表的輸出、資源與環境，避免讓原局能量持續失衡。`,
    '⑤': luck.tenGod?.includes('印')
      ? `在【${luck.ganzhi || '目前大運'}】期間選定一項證照、方法論或代表作，設定完成日期並公開交付。`
      : `把【${luck.ganzhi || '目前大運'}】的十年主題拆成年度成果，不只停留在感受運勢。`,
    '⑥': annual.tenGod?.includes('印')
      ? `${annual.year || '今年'}只挑一項最能提高專業可信度的進修或作品完成，避免把時間全花在蒐集資訊。`
      : `${annual.year || '今年'}設定一個可驗收的主要成果，按季檢查進度，不同時追逐過多方向。`,
    '⑦': '把定價、訂金、尾款、合作與分帳規則寫成固定文件，先保住收入品質再追求數量。',
    '⑧': '依本章判定的職涯型態集中累積案例、口碑與定價能力，暫停不符合定位的工作邀約。',
    '⑨': '固定安排一次不處理工作與雜事的對話，把需求、界線與現實分工直接說清楚。',
    '⑩': `${children.birthOrderText ? '胎次只視為傳統命理傾向；' : ''}作品方面把專業整理成可重複交付的模組，子女時機另配合實際人生規劃與流年判斷。`,
    '⑪': `固定照顧${health.dayMasterOrgans || '睡眠與消化'}；若已有持續不適，直接交由合格醫療專業評估，不以命理取代診斷。`,
    '⑫': '把適合的日子用於收款、提案或重要溝通，把健康注意日留給減量與休息，不因單一天象取消必要決策。',
    '⑬': `先整理${firstDirection}${secondDirection ? `與${secondDirection}` : ''}的雜物與光線，各放一項對應用途的物品即可，其餘老師明細留在折疊區查閱。`
  };
}

function enforceStructuredFacts(data, tags) {
  if (!data || typeof data !== 'object') return data;
  const chapterDefinitions = [
    ['①', '日主與五行特質'],
    ['②', '四柱宮位與十神結構'],
    ['③', '合化與刑沖牽動'],
    ['④', '命盤格局與生活調整'],
    ['⑤', '當前大運'],
    ['⑥', '流年影響'],
    ['⑦', '財運模式與防禦提醒'],
    ['⑧', '事業與職涯定位'],
    ['⑨', '感情與婚姻模式'],
    ['⑩', '子女與作品緣分'],
    ['⑪', '健康體質與保養'],
    ['⑫', '流日擇吉方向'],
    ['⑬', '風水與開運整合佈局']
  ];
  const actionFallbacks = chapterActionFallbacks(tags);
  const rawChapters = Array.isArray(tags?.rawChapters) ? tags.rawChapters : [];
  const generatedChapters = Array.isArray(data.chapterSummaries) ? data.chapterSummaries : [];
  const generatedByNumber = new Map(generatedChapters.map((chapter, index) => [
    String(chapter?.number || chapterDefinitions[index]?.[0] || ''),
    chapter
  ]));
  const statusFallbacks = chapterStatusFallbacks(tags);
  const decisionFallbacks = decisionAwareFallbacks(tags);
  const clientName = tags?.client?.name || tags?.clientContext?.name || '';
  data.chapterSummaries = chapterDefinitions.map(([number, title], index) => {
    const generated = generatedByNumber.get(number) || generatedChapters[index] || {};
    const bullets = Array.isArray(generated?.bullets) ? generated.bullets : [];
    const rawChapter = rawChapters[index];
    const generatedStatus = cleanChapterConclusion(bullets[0]?.value, { title, clientName });
    const generatedAction = cleanChapterConclusion(bullets[1]?.value, { title, clientName });
    const status = isCopiedOrCanned(generatedStatus, rawChapter)
      ? (decisionFallbacks[number]?.status || statusFallbacks[number])
      : generatedStatus;
    const action = isCopiedOrCanned(generatedAction, rawChapter)
      ? (decisionFallbacks[number]?.action || actionFallbacks[number])
      : generatedAction;
    return {
      number,
      title,
      bullets: [
        { label: '現況定性', value: status || statusFallbacks[number] },
        { label: '行動處方', value: action || actionFallbacks[number] }
      ]
    };
  });
  const counts = tags?.domains?.health?.elementCounts || {};
  const correctHealthText = (value) => {
    let text = String(value || '');
    for (const [element, rawCount] of Object.entries(counts)) {
      const count = Number(rawCount || 0);
      if (count >= 3) {
        text = text.replace(new RegExp(`${element}(?:氣)?(?:較弱|偏弱|不足|缺乏)`, 'g'), `${element}氣偏旺`);
      } else if (count === 0) {
        text = text.replace(new RegExp(`${element}(?:氣)?(?:旺盛|過旺|偏旺|較旺)`, 'g'), `${element}氣不足`);
      }
    }
    return text;
  };
  if (data.health && typeof data.health === 'object') {
    for (const key of ['headline', 'analysis', 'action']) data.health[key] = correctHealthText(data.health[key]);
  }
  const chapter11 = (data.chapterSummaries || []).find((chapter) => String(chapter?.number) === '⑪');
  if (chapter11) {
    chapter11.bullets = (chapter11.bullets || []).map((item) => ({
      ...item,
      value: correctHealthText(item?.value)
    }));
  }
  const children = tags?.domains?.children || {};
  const chapter10 = (data.chapterSummaries || []).find((chapter) => String(chapter?.number) === '⑩');
  if (chapter10 && children.gender) {
    const isMale = children.gender === '男';
    const birthOrder = Array.isArray(children.birthOrderSequence) ? children.birthOrderSequence : [];
    const sequenceText = birthOrder.length
      ? birthOrder.map((item) => item.label || `第${item.order}胎（${item.predictedGender}）`).join('、')
      : '原局沒有足夠訊號排列胎次';
    const workText = Number(children.workStarCount || 0) > 0
      ? `作品與專業成果有${children.workStarCount}個可用訊號，適合整理成可重複交付的服務、作品或方法。`
      : '作品輸出需要後天建立固定節奏，先把專業經驗整理成一套可重複使用的方法。';
    chapter10.bullets = [
      { label: '現況定性', value: `${isMale ? '男命' : '女命'}的子女緣分排列傾向為：${sequenceText}。${children.birthOrderDisclaimer || '此為命理結構傾向，不等於實際胎數、生理性別或生育保證。'}` },
      { label: '行動處方', value: `${workText}面對子女或晚輩，給予清楚規則，也保留各自發展空間。` }
    ];
  }
  const plainReplacements = [
    [/官印相生/g, '外界責任能透過學習、證照與平台支援轉成成果'],
    [/食傷生財/g, '作品與專業能直接轉成收入'],
    [/比劫奪財/g, '人情與合作容易造成資金流失'],
    [/官殺混雜/g, '外界規則與壓力來源較複雜'],
    [/日主身弱|身弱/g, '底氣與承載力較需要支持'],
    [/日主身強|身強/g, '自主性與承擔力較強'],
    [/專旺[／/]從強格|從強格|專旺格|身極旺/g, '自主性、持久力與主導需求非常強'],
    [/正官|七殺/g, '責任與外界要求'],
    [/正印|偏印/g, '學習、貴人與休息支援'],
    [/食神|傷官/g, '作品、表達與創意輸出'],
    [/比肩|劫財/g, '自我主張與同儕競合'],
    [/正財|偏財/g, '收入與現實資源'],
    [/官殺/g, '責任與外界要求'],
    [/印星/g, '學習與支援'],
    [/食傷/g, '作品與表達'],
    [/比劫/g, '同儕競合與自我主張'],
    [/財星/g, '現實資源與收入機會'],
    [/喜用神/g, '適合補充的生活能量'],
    [/忌神/g, '需要節制的生活能量'],
    [/月令/g, '出生月份的環境力量']
  ];
  const toPlainLanguage = (value) => plainReplacements.reduce((textValue, [pattern, replacement]) => textValue.replace(pattern, replacement), correctHealthText(String(value || '')));
  (data.chapterSummaries || []).forEach((chapter) => {
    const source = Array.isArray(chapter?.bullets) ? chapter.bullets : [];
    const values = source.map((item) => toPlainLanguage(item?.value)).filter(Boolean);
    chapter.bullets = [
      { label: '現況定性', value: values[0] || '本章資料已完成計算，重點需與整體命盤一起閱讀。' },
      { label: '行動處方', value: values[1] || '先從一項可執行的小調整開始，並依後續時間變化持續檢視。' }
    ];
  });
  return data;
}

function buildPrompt(body) {
  const mode = body.mode || 'polish';
  const outputType = body.outputType || body.format || 'article';
  const tone = body.tone || '專業、口語、清楚、溫暖，但不要像罐頭模板';
  const tags = safeString(body.tags || body.baziTags || {}, 36000);
  const draft = safeString(body.reportDraft || body.draft || body.article || '', 14000);
  const question = safeString(body.question || '', 2000);
  const history = safeString(body.history || [], 5000);

  if (mode === 'chat') {
    return [
      '你是命理師 Doris 的報告助理，請使用繁體中文回答。',
      '你會收到八字 Tag、目前報告內容與對話紀錄。請只根據這些資訊與一般八字概念回答，不要假裝看過未提供的老師講義。',
      '回答要口語、可直接拿去對客戶說明；不要恐嚇，不做醫療、法律、投資保證。',
      '避免罐頭句，尤其不要固定重複「親兄弟明算帳」或「把想到的東西寫下來」。',
      '回答格式固定為三段：一、結論；二、命盤依據；三、可以對客戶這樣說。',
      '每段都要完整收尾，總長度 300 到 900 個中文字。',
      '',
      '【八字 Tag】',
      tags,
      '',
      '【目前報告／草稿】',
      draft,
      '',
      '【對話紀錄】',
      history,
      '',
      '【使用者問題】',
      question
    ].join('\n');
  }

  if (mode === 'polish-core') {
    const coreTags = { ...(body.tags || body.baziTags || {}) };
    delete coreTags.rawChapters;
    return [
      '你是命理師 Doris 的八字報告潤飾引擎，請使用繁體中文。',
      '請根據已計算完成的動態命盤資料，生成「全盤情境化串聯」。這是命理師執業講稿，不是章節摘要。',
      '原局、大運、流年必須分清楚；不得把大運或流年的印星寫成原局印星旺。健康描述必須核對五行統計，不得把旺寫成弱、把存在寫成缺。',
      '性別是正式判讀條件：男命配偶看財星、子女看官星；女命配偶看官星、子女看食傷。',
      '文字要像舊版完整分析：先說核心矛盾，再串聯目前十年與今年時機，最後給可實行方向。不要複製統計摘要，不要只改寫數字。',
      '老師原始觀點由前端知識庫呈現，不可虛構老師引言。',
      '只回傳合法 JSON，不要 Markdown、code fence 或額外解說。結構必須是：',
      '{',
      '  "summary":"3到5句全盤情境解讀，必須是分析，不得重複命盤統計摘要",',
      '  "career":{"headline":"一句明確定位","analysis":"2到4句串聯分析","action":"一項具體行動"},',
      '  "wealth":{"headline":"一句明確定位","analysis":"2到4句串聯分析","action":"一項具體行動"},',
      '  "health":{"headline":"一句健康重點","analysis":"2到4句生活化分析","action":"一項保養提醒"},',
      '  "relationship":{"headline":"一句關係定位","analysis":"2到4句串聯分析","action":"一項溝通行動"},',
      '  "annual":{"headline":"一句年度主題","analysis":"2到4句大運流年分析","action":"一項年度行動"},',
      '  "fengShui":{"headline":"一句空間重點","analysis":"只取1到2個交集方位","action":"一項可執行佈置"},',
      '  "teacherFriendlyScript":"命理師可直接口頭說明的4到7句連貫講稿"',
      '}',
      '',
      '【動態命盤資料】',
      safeString(coreTags, 26000)
    ].join('\n');
  }

  if (mode === 'chapter-summaries') {
    return [
      '你是命理師 Doris 的章節摘要編輯，請使用繁體中文。',
      '只整理①到⑬章的「本章總結」，不可改寫上方全盤 Gemini 情境解讀。',
      '每章只能有兩點：現況定性、行動處方。必須依動態資料與原章內容判斷，去除重複套話。',
      '【現況定性】必須重新生成一句白話判斷，不可擷取原章第一句。嚴禁包含章節編號、章節標題、emoji、姓名、稱呼、親愛的、從你的命盤來看或任何開場白。',
      '【行動處方】只給一項可執行做法，不重述現況或章名。',
      '防重複硬規則：每一點不得連續沿用原章內文 8 個以上中文字；現況與行動也不得使用相同句型。請先理解原文，再用不同語序提煉。',
      '禁止空泛句：不得寫「前後階段呈現不同事件」、「需要一起判斷」、「看見自己的力量」、「依情況調整」等沒有直接結論的句子。',
      '總結須白話化；不要直接輸出官印相生、食傷生財、比劫奪財、官殺混雜等術語。',
      '第⑦到⑨章採用資料中的明確判型；第⑩章嚴格依性別與 birthOrderSequence，不可自行改胎次；健康須核對五行數量。',
      '章節專屬要求：⑤直接說明這十年要累積什麼；⑥直接說今年要完成什麼；⑦指出收入增長方式；⑧明確選定上班、接案或創業型態；⑨指出伴侶與相處需求；⑪指出最先受壓的身體系統；⑫說明流日如何實際安排。',
      '⑧範例：現況可寫「你更適合以個人專業與口碑承接複雜案件，不必靠擴大團隊證明能力」；行動可寫「整理一項代表性服務，補齊案例、流程與報價後集中曝光」。不得直接複製 decision.reason。',
      '正確範例：{"number":"①","title":"日主與五行特質","bullets":[{"label":"現況定性","value":"你是一個踏實、內斂且具包容力的人，習慣先消化情緒再承擔責任。"},{"label":"行動處方","value":"做決定前先確認自己的需求，避免無止境滿足他人。"}]}',
      '只回傳合法 JSON，不要 Markdown、code fence 或額外文字：',
      '{"chapterSummaries":[{"number":"①","title":"日主與五行特質","bullets":[{"label":"現況定性","value":"一句白話結論"},{"label":"行動處方","value":"一項具體行動"}]}]}',
      'chapterSummaries 必須依序完整輸出①到⑬，不可缺章，每章恰好兩點。',
      '',
      '【動態命盤資料與原章內容】',
      tags
    ].join('\n');
  }

  return [
    '你是命理師 Doris 的八字報告潤飾引擎，請使用繁體中文。',
    '你會收到後端已計算好的八字 Tag 與草稿。請做資料轉換與文案生成，不要自行發明命盤不存在的資訊。',
    '重要規則：',
    '0. 性別是正式判讀條件，不是稱謂資料。男命配偶／妻星看正財、偏財，子女星看正官、七殺；女命配偶／夫星看正官、七殺，子女星看食神、傷官。不得把男女命寫成同一套中性結論。',
    '1. 不要只做一對一十神模板，要根據 Tag 裡的十神數量、身強身弱、特殊格局、組合條件產生差異化。',
    '2. 若有 count >= 2 的十神，請寫出質變後的行為傾向與建議。',
    '3. 若有食傷生財、官印相生、財多身弱、傷官加偏財加身極旺等組合，優先寫組合綜效，再補單一十神。',
    '3-1. chart 是原局，timing 是大運與流年，兩者嚴禁混寫。不得因大運或流年是印星，就說「原局印星旺」或「命格中官印俱旺」。',
    '3-2. 只有 chart.originStructure.officialResourceBothPresent 為 true，才可說原局同見官印；仍不得僅憑數量直接稱為「極佳官印相生格局」。',
    '3-3. 若原局官星較旺，而 timing.currentLuck.isResource 或 timing.annual.isResource 為 true，應寫成：「原局官星較旺、責任壓力較重；目前印星大運／流年補入後，階段性形成官印相生，讓壓力有機會轉成資源、專業與成果。」',
    '3-4. 健康判讀必須逐項核對 domains.health.elementCounts、dominantElements、missingElements 與 controllingPressure。數量高才可寫旺，數量為 0 才可寫缺；只能依當次命盤的動態數值描述五行生剋、臟腑與生活壓力，禁止套用範例命盤或把旺寫成弱。',
    '3-5. 第⑩章採雙軌動態判讀：男命以正官、七殺看子女緣，以食神、傷官看作品輸出；女命以食神、傷官看子女緣，以官星、財星看作品與成果承接。另須讀取 domains.children.hourPillar，以時柱天干、地支、十神與五行生剋說明晚年、晚輩與成果質地。只能在 samePillarRooted 為 true 時稱為「同柱透藏／天透地藏」，不得用有根與未透互相矛盾的套話。',
    '4. 風水或擺件只輸出 1 到 2 個最精準交集，不要把所有方位全列出。',
    '5. 避免重複罐頭警語，請換成具體行動建議。',
    `6. 語氣：${tone}。`,
    '7. 上方 summary、各領域 analysis 與 teacherFriendlyScript 維持原本的全盤情境串聯寫法；以下白話與兩點格式限制只適用於 chapterSummaries。',
    '8. chapterSummaries 嚴禁直接出現「官印相生、食傷生財、比劫奪財、日主身弱、官殺混雜」等學理術語，必須翻成生活狀況與可執行行動。',
    '9. 第⑦、⑧、⑨章必須優先採用 tags.domains.wealth.decision、career.decision、relationship.decision 的確定判型，不得改寫成「都適合、視情況而定」。',
    '10. 第⑩章只能依 tags.domains.children.birthOrderSequence 的既定順序輸出胎次傾向，不得自行改序、增加或刪除；必須附上命理傾向並非生育保證的提醒。',
    outputType === 'json'
      ? [
          '請只回傳合法 JSON，不要 Markdown、不要 code fence、不要額外解說。',
          '必須完全符合這個結構：',
          '{',
          '  "summary": "2到4句的全盤串聯總結",',
          '  "keywords": [{"label":"面向名稱","value":"8到18字的關鍵結論","tone":"identity|career|wealth|relationship|health|annual"}],',
          '  "career": {"headline":"一句結論","analysis":"2到4句串聯分析","action":"一項具體行動"},',
          '  "wealth": {"headline":"一句結論","analysis":"2到4句串聯分析","action":"一項具體行動"},',
          '  "health": {"headline":"一句結論","analysis":"2到4句串聯分析","action":"一項日常保養提醒，不做醫療診斷"},',
          '  "relationship": {"headline":"一句結論","analysis":"2到4句串聯分析","action":"一項溝通行動"},',
          '  "annual": {"headline":"一句年度主題","analysis":"2到4句大運與流年串聯分析","action":"一項年度行動"},',
          '  "fengShui": {"headline":"一句空間重點","analysis":"只取1到2個交集方位的2到3句分析","action":"一項可執行佈置"},',
          '  "teacherFriendlyScript": "命理師可直接口頭說明的3到6句連貫講稿",',
          '  "chapterSummaries": [{"number":"①","title":"日主與五行特質","bullets":[{"label":"現況定性","value":"一句白話結論"},{"label":"行動處方","value":"一項具體行動"}]}]',
          '}',
          'keywords 請提供 5 到 7 個，tone 只能使用指定值。各 analysis 必須是連貫文章，不得用條列符號。',
          'chapterSummaries 必須依序完整輸出 ① 到 ⑬，不能缺章。每章恰好 2 個 bullets，第一個 label 必須是「現況定性」，第二個必須是「行動處方」。',
          '各章內容責任：①日主屬性、特質、盲點；②四柱宮位與十神作用；③實際合化刑沖與生活牽動；④格局、喜用與節制；⑤大運主軸與前後期；⑥流年氣場與大運疊加；⑦財星結構與風險；⑧十神組合後的職涯定位；⑨依性別判定配偶星與夫妻宮；⑩性別星位、時柱成果質地與綜合結論；⑪依五行統計判定健康；⑫流日方向；⑬只留1至2個風水交集與可執行擺設。',
          'chapterSummaries 的內容只可摘要 tags.rawChapters 與已計算 Tag；禁止開場白、稱呼、段落散文、Markdown、HTML、cite 標記或虛構來源。',
          'chapterSummaries 白話替換：官殺＝責任、壓力、規則、客戶要求；印星＝貴人、學習、證照、品牌支援、休息；食傷＝作品、表達、創意、輸出；比劫＝人情支出、合作風險、自我主張、同儕競合；財星＝現實資源、收入、收款規則與資金安全感。',
          '全域去重：同一結論、形容詞或十神定義若已在前章說明，後章不得換句話重複；後章只保留該章獨有的判讀。',
          '不得虛構老師姓名、引言、課程內容或未提供的命盤事實；老師原始觀點由前端既有知識庫另外呈現。'
        ].join('\n')
      : '請回傳可直接放進網頁的文章內容，分段清楚，每段 2 到 4 句。',
    '',
    '【八字 Tag】',
    tags,
    '',
    '【報告草稿】',
    draft || '（無草稿，請依 Tag 生成）'
  ].join('\n');
}

function cleanModelName(name) {
  return String(name || '').replace(/^models\//, '');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listTextModels(apiKey) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) return [];
  return (data.models || [])
    .filter((model) => (model.supportedGenerationMethods || []).includes('generateContent'))
    .map((model) => cleanModelName(model.name));
}

async function resolveGeminiModel(apiKey, excluded = []) {
  if (cachedGeminiModel && !excluded.includes(cachedGeminiModel)) return cachedGeminiModel;
  const configured = cleanModelName(process.env.GEMINI_MODEL);
  const available = await listTextModels(apiKey);
  const candidates = [configured, ...MODEL_PREFERENCES].filter(Boolean);
  const selected = candidates.find((name) => available.includes(name) && !excluded.includes(name))
    || available.find((name) => /flash/i.test(name) && !/image|audio|live|tts/i.test(name) && !excluded.includes(name))
    || candidates.find((name) => !excluded.includes(name))
    || DEFAULT_GEMINI_MODEL;
  cachedGeminiModel = selected;
  return selected;
}

async function requestGemini(apiKey, model, prompt, body) {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const response = await fetch(`${endpoint}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: Number(body.temperature ?? 0.45),
        topP: Number(body.topP ?? 0.9),
        maxOutputTokens: Number(body.maxOutputTokens ?? 5200),
        ...((body.outputType || body.format) === 'json' ? { responseMimeType: 'application/json' } : {})
      }
    })
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

async function requestGeminiWithRetry(apiKey, model, prompt, body) {
  let response;
  let data;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    ({ response, data } = await requestGemini(apiKey, model, prompt, body));
    if (response.ok) break;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 1) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 2000)
      : 700 * (2 ** attempt);
    await sleep(delay);
  }
  return { response, data };
}

async function callGemini(prompt, body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('後端尚未設定 GEMINI_API_KEY。');
    err.statusCode = 500;
    throw err;
  }

  let model = await resolveGeminiModel(apiKey);
  let { response, data } = await requestGeminiWithRetry(apiKey, model, prompt, body);
  const unavailable = /not found|not supported|no longer available|deprecated|shut down/i.test(data.error?.message || '');
  if (!response.ok && (response.status === 404 || unavailable)) {
    cachedGeminiModel = '';
    const replacement = await resolveGeminiModel(apiKey, [model]);
    if (replacement !== model) {
      model = replacement;
      ({ response, data } = await requestGeminiWithRetry(apiKey, model, prompt, body));
    }
  }

  // Free-tier quotas are often model-specific. If the preferred model is
  // exhausted, try one available Flash alternative before returning 429.
  if (!response.ok && response.status === 429) {
    cachedGeminiModel = '';
    const replacement = await resolveGeminiModel(apiKey, [model]);
    if (replacement !== model) {
      model = replacement;
      ({ response, data } = await requestGeminiWithRetry(apiKey, model, prompt, body));
    }
  }
  if (!response.ok) {
    const message = data.error?.message || `Gemini API 錯誤：${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    err.code = response.status === 429 ? 'GEMINI_RATE_LIMIT' : 'GEMINI_REQUEST_FAILED';
    throw err;
  }

  const candidate = data.candidates?.[0] || {};
  return {
    model,
    text: sanitizeGeminiOutput((candidate.content?.parts || []).map((part) => part.text || '').join('\n')),
    finishReason: candidate.finishReason || '',
    usageMetadata: data.usageMetadata || null
  };
}

module.exports = async function handler(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: '只接受 POST。' });
    return;
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const tags = body.tags || body.baziTags || {};
    const wantsJson = (body.outputType || body.format) === 'json';

    if ((body.mode || 'polish') === 'polish' && wantsJson) {
      const coreBody = { ...body, mode: 'polish-core', maxOutputTokens: Math.min(Number(body.maxOutputTokens) || 4200, 4200) };
      const coreResult = await callGemini(buildPrompt(coreBody), coreBody);
      const coreData = tryParseJson(coreResult.text);
      if (!coreData?.summary) {
        const error = new Error('Gemini 全盤情境解讀回傳不完整，未以本機摘要冒充 AI 內容。請稍後重新生成。');
        error.statusCode = 502;
        error.code = 'GEMINI_CORE_INCOMPLETE';
        throw error;
      }

      let chapterResult = null;
      let chapterData = null;
      try {
        const chapterBody = { ...body, mode: 'chapter-summaries', maxOutputTokens: 3600 };
        chapterResult = await callGemini(buildPrompt(chapterBody), chapterBody);
        chapterData = tryParseJson(chapterResult.text);
      } catch (chapterError) {
        console.warn('Gemini chapter summaries unavailable; using calculated chapter fallback:', chapterError.message);
      }

      const merged = enforceStructuredFacts({
        ...coreData,
        chapterSummaries: Array.isArray(chapterData?.chapterSummaries) ? chapterData.chapterSummaries : []
      }, tags);

      res.status(200).json({
        ok: true,
        model: coreResult.model,
        chapterModel: chapterResult?.model || '',
        outputType: 'json',
        text: coreResult.text,
        json: merged,
        usedFallback: !chapterData,
        finishReason: coreResult.finishReason,
        usageMetadata: coreResult.usageMetadata
      });
      return;
    }

    const prompt = buildPrompt(body);
    const result = await callGemini(prompt, body);
    const parsed = wantsJson ? tryParseJson(result.text) : null;
    const parsedJson = wantsJson
      ? enforceStructuredFacts(parsed || createFallbackReport(tags), tags)
      : null;

    res.status(200).json({
      ok: true,
      model: result.model,
      outputType: body.outputType || body.format || 'article',
      text: result.text,
      json: parsedJson,
      usedFallback: wantsJson && !parsed,
      finishReason: result.finishReason,
      usageMetadata: result.usageMetadata
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Gemini route failed.',
      code: error.code || 'GEMINI_ROUTE_FAILED'
    });
  }
};
