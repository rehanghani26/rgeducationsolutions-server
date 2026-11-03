import OpenAI from 'openai';
import dotenv from 'dotenv';
import path from 'path';

// Load environment variables if available
dotenv.config({ path: path.resolve(process.cwd(), '.env') });
dotenv.config({ path: path.resolve(process.cwd(), 'server', '.env') });

// ════════════════════════════════════════════════════════════════════════════════
// 1. ALL AVAILABLE NVIDIA MODELS (Constants)
// ════════════════════════════════════════════════════════════════════════════════
export const MODEL_NVIDIA_3_5    = "nvidia/nemotron-3.5-lightning-30b-a3b";        // NVIDIA Nemotron 3.5 (Reasoning / Thinking)
export const MODEL_NVIDIA_3      = "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning"; // NVIDIA Nemotron 3 (Reasoning / Thinking)
export const MODEL_LLAMA_3_3_70B = "meta/llama-3.3-70b-instruct";                 // Meta Llama 3.3 70B
export const MODEL_LLAMA_3_1_70B = "meta/llama-3.1-70b-instruct";                 // Meta Llama 3.1 70B
export const MODEL_NEMOTRON_70B  = "nvidia/llama-3.1-nemotron-70b-instruct";       // NVIDIA Nemotron 70B
export const MODEL_LLAMA_3_1_8B  = "meta/llama-3.1-8b-instruct";                  // Meta Llama 3.1 8B

// ════════════════════════════════════════════════════════════════════════════════
// 2. ACTIVE MODEL SELECTOR
// 👉 Change ONLY this one variable to switch models & settings automatically!
// ════════════════════════════════════════════════════════════════════════════════
export const SELECTED_MODEL = MODEL_NVIDIA_3_5;
// export const SELECTED_MODEL = MODEL_NVIDIA_3;
// export const SELECTED_MODEL = MODEL_LLAMA_3_3_70B;
// export const SELECTED_MODEL = MODEL_LLAMA_3_1_70B;
// export const SELECTED_MODEL = MODEL_NEMOTRON_70B;
// export const SELECTED_MODEL = MODEL_LLAMA_3_1_8B;

// ════════════════════════════════════════════════════════════════════════════════
// 3. MODEL PROFILES & ADAPTIVE PARAMETERS
// ════════════════════════════════════════════════════════════════════════════════
const MODEL_CONFIGS = {
  [MODEL_NVIDIA_3_5]: {
    name: "NVIDIA Nemotron 3.5 (Reasoning)",
    temperature: 1,
    top_p: 0.95,
    max_tokens: 16384,
    reasoning_budget: 16384,
    chat_template_kwargs: { enable_thinking: true },
  },
  [MODEL_NVIDIA_3]: {
    name: "NVIDIA Nemotron 3 (Reasoning)",
    temperature: 0.6,
    top_p: 0.95,
    max_tokens: 16384,
    reasoning_budget: 16384,
    chat_template_kwargs: { enable_thinking: true },
  },
  [MODEL_LLAMA_3_3_70B]: {
    name: "Meta Llama 3.3 70B",
    temperature: 0.5,
    top_p: 1,
    max_tokens: 4096,
  },
  [MODEL_LLAMA_3_1_70B]: {
    name: "Meta Llama 3.1 70B",
    temperature: 0.5,
    top_p: 1,
    max_tokens: 4096,
  },
  [MODEL_NEMOTRON_70B]: {
    name: "NVIDIA Nemotron 70B",
    temperature: 0.5,
    top_p: 1,
    max_tokens: 4096,
  },
  [MODEL_LLAMA_3_1_8B]: {
    name: "Meta Llama 3.1 8B",
    temperature: 0.5,
    top_p: 1,
    max_tokens: 2048,
  },
};

const activeConfig = MODEL_CONFIGS[SELECTED_MODEL] || MODEL_CONFIGS[MODEL_NVIDIA_3_5];

const openai = new OpenAI({
  apiKey: process.env.NVIDIA_API_KEY || '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',
  baseURL: process.env.NVIDIA_BASE_URL || 'https://integrate.api.nvidia.com/v1',
});

async function main() {
  console.log(`\n======================================================`);
  console.log(`🤖 Selected Model : ${SELECTED_MODEL}`);
  console.log(`⚙️  Model Profile  : ${activeConfig.name}`);
  console.log(`🌡️  Temperature    : ${activeConfig.temperature}`);
  console.log(`======================================================\n`);
  
  try {
    const requestPayload = {
      model: SELECTED_MODEL,
      messages: [
        { role: 'user', content: 'Write a limerick about the wonders of GPU computing.' }
      ],
      temperature: activeConfig.temperature,
      top_p: activeConfig.top_p,
      max_tokens: activeConfig.max_tokens,
      stream: true,
    };

    if (activeConfig.reasoning_budget) {
      requestPayload.reasoning_budget = activeConfig.reasoning_budget;
      requestPayload.chat_template_kwargs = activeConfig.chat_template_kwargs;
    }

    const completion = await openai.chat.completions.create(requestPayload);

    for await (const chunk of completion) {
      const reasoning = chunk.choices[0]?.delta?.reasoning_content;
      if (reasoning) {
        process.stdout.write(reasoning);
      }
      process.stdout.write(chunk.choices[0]?.delta?.content || '');
    }
    console.log('\n\n✅ Stream completed successfully.\n');
  } catch (error) {
    console.error('\n❌ NVIDIA API Error:', error.message || error);
  }
}

main();
