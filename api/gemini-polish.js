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

function buildPrompt(body) {
  const mode = body.mode || 'polish';
  const outputType = body.outputType || body.format || 'article';
  const tone = body.tone || '專業、口語、清楚、溫暖，但不要像罐頭模板';
  const tags = safeString(body.tags || body.baziTags || {}, 14000);
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
    '4. 風水或擺件只輸出 1 到 2 個最精準交集，不要把所有方位全列出。',
    '5. 避免重複罐頭警語，請換成具體行動建議。',
    `6. 語氣：${tone}。`,
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
          '  "teacherFriendlyScript": "命理師可直接口頭說明的3到6句連貫講稿"',
          '}',
          'keywords 請提供 5 到 7 個，tone 只能使用指定值。各 analysis 必須是連貫文章，不得用條列符號。',
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
        maxOutputTokens: Number(body.maxOutputTokens ?? 2600),
        ...((body.outputType || body.format) === 'json' ? { responseMimeType: 'application/json' } : {})
      }
    })
  });
  const data = await response.json().catch(() => ({}));
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
  let response;
  let data;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    ({ response, data } = await requestGemini(apiKey, model, prompt, body));
    if (response.ok) break;
    if (![429, 500, 502, 503, 504].includes(response.status) || attempt === 2) break;
    const retryAfter = Number(response.headers.get('retry-after'));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 5000)
      : 700 * (2 ** attempt);
    await sleep(delay);
  }
  const unavailable = /not found|not supported|no longer available|deprecated|shut down/i.test(data.error?.message || '');
  if (!response.ok && (response.status === 404 || unavailable)) {
    cachedGeminiModel = '';
    const replacement = await resolveGeminiModel(apiKey, [model]);
    if (replacement !== model) {
      model = replacement;
      ({ response, data } = await requestGemini(apiKey, model, prompt, body));
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
    const parsedJson = (body.outputType || body.format) === 'json' ? tryParseJson(result.text) : null;

    res.status(200).json({
      ok: true,
      model: result.model,
      outputType: body.outputType || body.format || 'article',
      text: result.text,
      json: parsedJson,
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
