import OpenAI from 'openai';
import { OPENAI_MODEL } from './_shared';
export async function completeStructuredJson(req) {
    const client = new OpenAI({ apiKey: req.apiKey });
    const response = await client.chat.completions.create({
        model: OPENAI_MODEL,
        messages: [
            { role: 'system', content: req.system },
            { role: 'user', content: req.user }
        ],
        temperature: req.temperature ?? 0.2,
        max_tokens: req.maxTokens,
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: req.schemaName,
                strict: false,
                schema: req.schema
            }
        }
    });
    const content = response.choices[0]?.message?.content;
    if (!content?.trim()) {
        throw new Error('OpenAI retornou resposta vazia');
    }
    return content;
}
