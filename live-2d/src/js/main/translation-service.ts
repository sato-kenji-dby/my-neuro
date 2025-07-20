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
  api_url: string; // 这是主LLM后端的URL
  model: string;
  provider: string;
}

class TranslationService {
  private config: TranslationServiceConfig;
  private llmConfig: LLMConfig;

  constructor(config: TranslationServiceConfig, llmConfig: LLMConfig) {
    this.config = config;
    this.llmConfig = llmConfig;
  }

  async translate(
    text: string
  ): Promise<{ translatedText: string; wasTranslated: boolean }> {
    if (!this.config.enabled) {
      return { translatedText: text, wasTranslated: false };
    }

    try {
      const response = await fetch(`${this.llmConfig.api_url}/translate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: text,
          source_lang: this.config.source_lang,
          target_lang: this.config.target_lang,
          prompt: this.config.prompt,
        }),
      });

      if (!response.ok) {
        const errorData = await response
          .json()
          .catch(() => ({ detail: 'Unknown error' }));
        throw new Error(
          `Translation API request failed: ${response.status} - ${errorData.detail}`
        );
      }

      const data = await response.json();
      const translatedText = data.translatedText;

      console.log(`Original: ${text} -> Translated: ${translatedText}`);
      return { translatedText, wasTranslated: true };
    } catch (error) {
      console.error('翻译服务错误:', error);
      return { translatedText: text, wasTranslated: false };
    }
  }
}

export { TranslationService };
