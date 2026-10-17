/**
 * Thin Gemini client shared by the job parser, skills-gap planner,
 * interview prep, and semantic STAR matcher.
 * The API key is sent in a header (not the URL) so it never lands in logs.
 */

// Model IDs are retired periodically; update here if the API returns a 404.
export const GEMINI_MODEL = 'gemini-3.8-flash';
export const GEMINI_EMBED_MODEL = 'gemini-embedding-001';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

async function geminiFetch(path, apiKey, body) {
  const res = await fetch(`${BASE_URL}/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini error ${res.status}: ${errText.slice(0, 180)}`);
  }
  return res.json();
}

/**
 * Ask Gemini for schema-constrained JSON. Never returns free-form chat text.
 * @param {{ apiKey: string, prompt: string, schema: object, temperature?: number }} opts
 */
export async function callGeminiJson({ apiKey, prompt, schema, temperature = 0.2 }) {
  const data = await geminiFetch(`models/${GEMINI_MODEL}:generateContent`, apiKey, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      responseMimeType: 'application/json',
      responseSchema: schema,
    },
  });

  const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Empty Gemini response');
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('Gemini returned malformed JSON');
  }
}

/**
 * Embed several texts in one request.
 * @returns {Promise<number[][]>} one vector per input text
 */
export async function embedTexts({ apiKey, texts }) {
  const data = await geminiFetch(`models/${GEMINI_EMBED_MODEL}:batchEmbedContents`, apiKey, {
    requests: texts.map((text) => ({
      model: `models/${GEMINI_EMBED_MODEL}`,
      content: { parts: [{ text }] },
      taskType: 'SEMANTIC_SIMILARITY',
      outputDimensionality: 768,
    })),
  });

  const vectors = (data.embeddings || []).map((e) => e.values);
  if (vectors.length !== texts.length || vectors.some((v) => !Array.isArray(v))) {
    throw new Error('Gemini returned an unexpected embedding response');
  }
  return vectors;
}
