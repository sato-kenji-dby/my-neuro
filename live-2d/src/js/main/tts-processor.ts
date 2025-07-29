import { TranslationService } from './translation-service';

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

interface TTSConfig {
  tts?: {
    url?: string;
    language?: string;
  };
  translator?: TranslationServiceConfig;
  llm?: LLMConfig;
}

class TTSProcessor {
  private config: TTSConfig;
  private ttsUrl: string;
  private language: string;
  private translationService: TranslationService;
  private ipcSender: (channel: string, ...args: unknown[]) => void;
  private audioQueue: {
    originalText: string;
    translatedText: string;
    wasTranslated: boolean;
  }[] = [];
  private isPlaying: boolean = false;
  private sentenceBuffer: string = ''; // 用于缓存流式文本
  private originalSentenceBuffer: string = ''; // 用于缓存原始流式文本

  constructor(
    ipcSender: (channel: string, ...args: unknown[]) => void,
    config: TTSConfig
  ) {
    this.ipcSender = ipcSender;
    this.config = config || {};
    this.ttsUrl = this.config.tts?.url || '';
    this.language = this.config.tts?.language || 'zh';
    this.translationService = new TranslationService(
      this.config.translator,
      this.config.llm
    );
  }

  public async processTextToSpeech(originalText: string) {
    if (!originalText.trim()) return;

    // const translationResult =
    //   await this.translationService.translate(originalText);

    // 使用原始文本进行分段，确保TTS的输入是原始语言的正确分段
    const originalSegments = originalText.split(/([,。，？！；;：:])/g);
    let tempOriginalSegment = '';

    for (let i = 0; i < originalSegments.length; i++) {
      tempOriginalSegment += originalSegments[i];
      if (i % 2 === 1 || i === originalSegments.length - 1) {
        if (tempOriginalSegment.trim()) {
          // 对每个原始分段进行翻译
          const segmentTranslationResult =
            await this.translationService.translate(tempOriginalSegment.trim());
          this.audioQueue.push({
            originalText: tempOriginalSegment.trim(),
            translatedText: segmentTranslationResult.translatedText,
            wasTranslated: segmentTranslationResult.wasTranslated,
          });
        }
        tempOriginalSegment = '';
      }
    }
    this.playNextInQueue();
  }

  public async processStreamedText(originalTextChunk: string) {
    this.originalSentenceBuffer += originalTextChunk;
    const sentenceEnders = /([,。，？！；;：:])/g;

    let match;
    while (
      (match = sentenceEnders.exec(this.originalSentenceBuffer)) !== null
    ) {
      const originalSentence = this.originalSentenceBuffer.substring(
        0,
        match.index + match[1].length
      );
      this.originalSentenceBuffer = this.originalSentenceBuffer.substring(
        originalSentence.length
      );

      if (originalSentence.trim()) {
        const translationResult = await this.translationService.translate(
          originalSentence.trim()
        );
        this.audioQueue.push({
          originalText: originalSentence.trim(),
          translatedText: translationResult.translatedText,
          wasTranslated: translationResult.wasTranslated,
        });
        this.playNextInQueue();
      }
    }
  }

  public async streamEnded() {
    if (this.originalSentenceBuffer.trim()) {
      const translationResult = await this.translationService.translate(
        this.originalSentenceBuffer.trim()
      );
      this.audioQueue.push({
        originalText: this.originalSentenceBuffer.trim(),
        translatedText: translationResult.translatedText,
        wasTranslated: translationResult.wasTranslated,
      });
      this.playNextInQueue();
      this.originalSentenceBuffer = '';
    }
    // 当音频队列为空且流已结束时，发送对话结束信号
    if (this.audioQueue.length === 0 && !this.isPlaying) {
      this.ipcSender('dialogue-ended');
    }
  }

  private async playNextInQueue() {
    if (this.isPlaying || this.audioQueue.length === 0) {
      return;
    }
    this.isPlaying = true;
    const { originalText, translatedText, wasTranslated } =
      this.audioQueue.shift()!;
    await this.sendSegmentToTts(originalText, translatedText, wasTranslated);
  }

  public handlePlaybackFinished() {
    this.isPlaying = false;
    this.playNextInQueue();
    // 检查在播放完毕后，队列是否为空，以及流是否已结束（通过buffer判断）
    if (this.audioQueue.length === 0 && this.sentenceBuffer === '') {
      // 延迟发送，确保是最后一条消息
      setTimeout(() => {
        if (this.audioQueue.length === 0 && !this.isPlaying) {
          this.ipcSender('dialogue-ended');
        }
      }, 100);
    }
  }

  private async sendSegmentToTts(
    originalSegment: string,
    translatedSegment: string,
    wasTranslated: boolean
  ) {
    try {
      // TTS的输入文本应该是原始的、未经翻译的文本
      const cleanedOriginalSegment = originalSegment.replace(/<[^>]+>/g, '');
      
      // 如果清理后的文本段为空或只包含空白符，则跳过TTS请求
      if (!cleanedOriginalSegment.trim()) {
        this.ipcSender('debug', `TTS请求跳过：文本段在清理后为空或只含空白符。原始段落: "${originalSegment}"`);
        this.isPlaying = false; // 释放播放锁
        this.playNextInQueue(); // 继续处理队列中的下一个
        return; 
      }

      // 增加日志，打印实际发送给TTS后端的文本和语言
      this.ipcSender(
        'debug',
        `发送TTS请求: URL=${this.ttsUrl}, Text="${cleanedOriginalSegment}", Language="${this.language}"`
      );

      const response = await fetch(this.ttsUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: cleanedOriginalSegment, // 使用原始文本作为TTS输入
          text_language: this.language, // 假设TTS语言是原始语言
        }),
      });

      if (!response.ok) {
        throw new Error(`TTS request failed: ${response.status}`);
      }

      const audioArrayBuffer = await response.arrayBuffer();

      // 清理翻译后的文本中的情感标签，用于字幕显示
      const cleanedTranslatedSegment = translatedSegment.replace(
        /<[^>]+>/g,
        ''
      );

      // Send audio data (ArrayBuffer), translated text, and translation status to renderer process for playback
      this.ipcSender('play-audio', {
        audioArrayBuffer,
        text: originalSegment, // 原始文本用于情感驱动
        cleanedText: cleanedTranslatedSegment, // 清理后的翻译文本用于字幕
        wasTranslated,
      });
    } catch (error) {
      console.error('TTS segment processing error:', error);
    }
  }

  public interrupt() {
    this.audioQueue = [];
    this.isPlaying = false;
    this.ipcSender('interrupt-playback');
  }

  public reset() {
    this.interrupt();
    this.sentenceBuffer = '';
    this.originalSentenceBuffer = ''; // 重置原始文本缓冲区
  }
}

export { TTSProcessor };
