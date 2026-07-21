const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

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
    '1. 不要只做一對一十神模板，要根據 Tag 裡的十神數量、身強身弱、特殊格局、組合條件產生差異化。',
    '2. 若有 count >= 2 的十神，請寫出質變後的行為傾向與建議。',
    '3. 若有食傷生財、官印相生、財多身弱、傷官加偏財加身極旺等組合，優先寫組合綜效，再補單一十神。',
    '4. 風水或擺件只輸出 1 到 2 個最精準交集，不要把所有方位全列出。',
    '5. 避免重複罐頭警語，請換成具體行動建議。',
    `6. 語氣：${tone}。`,
    outputType === 'json'
      ? '請只回傳合法 JSON，不要 Markdown。欄位建議：summary、highlights、career、wealth、health、relationship、fengShui、teacherFriendlyScript。'
      : '請回傳可直接放進網頁的文章內容，分段清楚，每段 2 到 4 句。',
    '',
    '【八字 Tag】',
    tags,
    '',
    '【報告草稿】',
    draft || '（無草稿，請依 Tag 生成）'
  ].join('\n');
}

async function callGemini(prompt, body) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const err = new Error('後端尚未設定 GEMINI_API_KEY。');
    err.statusCode = 500;
    throw err;
  }

  const response = await fetch(`${GEMINI_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: Number(body.temperature ?? 0.45),
        topP: Number(body.topP ?? 0.9),
        maxOutputTokens: Number(body.maxOutputTokens ?? 2600)
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `Gemini API 錯誤：${response.status}`;
    const err = new Error(message);
    err.statusCode = response.status;
    throw err;
  }

  const candidate = data.candidates?.[0] || {};
  return {
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
      model: GEMINI_MODEL,
      outputType: body.outputType || body.format || 'article',
      text: result.text,
      json: parsedJson,
      finishReason: result.finishReason,
      usageMetadata: result.usageMetadata
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      ok: false,
      error: error.message || 'Gemini route failed.'
    });
  }
};
