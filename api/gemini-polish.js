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
  const actionFallbacks = {
    '①': '做決定前先確認自己的真正需求，再把穩定與責任感用在最重要的事情上。',
    '②': '分開觀察家庭、工作、關係與長期成果，不要用同一種反應方式處理所有人生領域。',
    '③': '當工作、家庭與關係互相牽動時，先說清楚界線與優先順序，再做承諾。',
    '④': '把力氣放在能恢復平衡的生活選擇，避免長期勉強自己承接超出負荷的責任。',
    '⑤': '依目前十年環境安排學習與成果節點，前後階段採用不同的工作節奏。',
    '⑥': '今年先選一項最重要的目標落地，避免同時追逐太多方向而分散力氣。',
    '⑦': '收入、合作與分帳一律先寫清楚規則，並保留可持續運作的現金緩衝。',
    '⑧': '依本章判定的職涯型態集中累積作品、口碑與定價能力，避開不合適的工作結構。',
    '⑨': '固定安排坦誠溝通的時間，把期待、界線與現實分工說清楚。',
    '⑩': '子女判讀只作為命理傾向參考；作品方面則建立可重複執行的固定產出節奏。',
    '⑪': '健康內容只作日常保養提醒；若有持續不適，應交由合格醫療專業判斷。',
    '⑫': '把流日當成安排節奏的提醒，不用因單一天象取消必要的生活與工作決定。',
    '⑬': '只挑一至兩個最重要方位維持乾淨明亮，先改善動線，再增加少量合適擺設。'
  };
  const rawChapters = Array.isArray(tags?.rawChapters) ? tags.rawChapters : [];
  const generatedChapters = Array.isArray(data.chapterSummaries) ? data.chapterSummaries : [];
  const generatedByNumber = new Map(generatedChapters.map((chapter, index) => [
    String(chapter?.number || chapterDefinitions[index]?.[0] || ''),
    chapter
  ]));
  data.chapterSummaries = chapterDefinitions.map(([number, title], index) => {
    const generated = generatedByNumber.get(number) || generatedChapters[index] || {};
    const raw = rawChapters.find((chapter) => String(chapter?.number) === number)?.raw || '';
    const rawSummary = String(raw).split(/[。！？]/).map((item) => item.trim()).find(Boolean);
    const bullets = Array.isArray(generated?.bullets) ? generated.bullets : [];
    return {
      number,
      title: String(generated?.title || title),
      bullets: [
        { label: '現況定性', value: String(bullets[0]?.value || rawSummary || `${title}已完成本機命盤比對。`) },
        { label: '行動處方', value: String(bullets[1]?.value || actionFallbacks[number]) }
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
  const chapterByNumber = (number) => (data.chapterSummaries || []).find((chapter) => String(chapter?.number) === number);
  const careerDecision = tags?.domains?.career?.decision;
  const wealthDecision = tags?.domains?.wealth?.decision;
  const relationshipDecision = tags?.domains?.relationship?.decision;
  if (careerDecision && chapterByNumber('⑧')) chapterByNumber('⑧').bullets = [
    { label: '現況定性', value: `職涯定位是「${careerDecision.type}」：${careerDecision.reason}。` },
    { label: '行動處方', value: careerDecision.avoid }
  ];
  if (wealthDecision && chapterByNumber('⑦')) chapterByNumber('⑦').bullets = [
    { label: '現況定性', value: `獲利模式是「${wealthDecision.type}」：${wealthDecision.path}。` },
    { label: '行動處方', value: wealthDecision.risk }
  ];
  if (relationshipDecision && chapterByNumber('⑨')) chapterByNumber('⑨').bullets = [
    { label: '現況定性', value: `關係定位是「${relationshipDecision.type}」：${relationshipDecision.partner}。` },
    { label: '行動處方', value: relationshipDecision.blindspot }
  ];
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
    const prompt = buildPrompt(body);
    const result = await callGemini(prompt, body);
    const tags = body.tags || body.baziTags || {};
    const wantsJson = (body.outputType || body.format) === 'json';
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
