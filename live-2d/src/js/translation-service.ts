import { GoogleGenAI } from '@google/genai';

interface TranslationServiceConfig {
    enabled: boolean;
    provider: string;
    api_url: string;
    source_lang: string;
    target_lang: string;
    prompt: string;
}

interface LLMConfig {
    api_key: string;
    api_url: string;
    model: string;
    provider: string;
}

class TranslationService {
    private config: TranslationServiceConfig;
    private llmConfig: LLMConfig;
    private ai: GoogleGenAI | null = null;

    constructor(config: TranslationServiceConfig, llmConfig: LLMConfig) {
        this.config = config;
        this.llmConfig = llmConfig;

        if (this.config.enabled && this.config.provider === 'google_aistudio') {
            this.ai = new GoogleGenAI({ apiKey: this.llmConfig.api_key });
        }
    }

    async translate(text: string): Promise<string> {
        if (!this.config.enabled) {
            return text; // 如果翻译未启用，直接返回原始文本
        }

        try {
            if (this.config.provider === 'google_aistudio' && this.ai) {
                console.log("\nOriginal (for translation):" + text);
                const response = await this.ai.models.generateContent({
                    model: this.llmConfig.model,
                    contents: text,
                    config: {
                        systemInstruction: this.config.prompt
                    },
                });
                const translatedText = response.text ?? text; // Use nullish coalescing to ensure string type
                console.log("\nTranslated:" + translatedText);
                return translatedText;
            } else {
                // Fallback for other providers or if AI not initialized
                console.warn('翻译服务提供商未配置或不支持，返回原始文本。');
                return text;
            }
        } catch (error) {
            console.error('翻译服务错误:', error);
            // 如果翻译失败，返回原始文本，不阻止后续流程
            return text;
        }
    }
}

export { TranslationService };
