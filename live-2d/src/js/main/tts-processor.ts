import { TranslationService } from './translation-service';

class TTSProcessor {
    private config: any;
    private ttsUrl: string;
    private language: string;
    private translationService: TranslationService;
    private ipcSender: (channel: string, ...args: any[]) => void;
    private audioQueue: { text: string }[] = [];
    private isPlaying: boolean = false;
    private sentenceBuffer: string = ''; // 用于缓存流式文本

    constructor(
        ipcSender: (channel: string, ...args: any[]) => void,
        config: any
    ) {
        this.ipcSender = ipcSender;
        this.config = config || {};
        this.ttsUrl = this.config.tts?.url;
        this.language = this.config.tts?.language || "zh";
        this.translationService = new TranslationService(this.config.translator, this.config.llm);
    }

    public async processTextToSpeech(text: string) {
        if (!text.trim()) return;

        const translatedText = await this.translationService.translate(text);
        
        const segments = translatedText.split(/([,。，？！；;：:])/g);
        let tempSegment = "";
        for (let i = 0; i < segments.length; i++) {
            tempSegment += segments[i];
            if (i % 2 === 1 || i === segments.length - 1) {
                if (tempSegment.trim()) {
                    this.audioQueue.push({ text: tempSegment.trim() });
                }
                tempSegment = "";
            }
        }
        this.playNextInQueue();
    }

    public async processStreamedText(text: string) {
        this.sentenceBuffer += text;
        const sentenceEnders = /([,。，？！；;：:])/g;
        
        let match;
        while ((match = sentenceEnders.exec(this.sentenceBuffer)) !== null) {
            const sentence = this.sentenceBuffer.substring(0, match.index + match[1].length);
            this.sentenceBuffer = this.sentenceBuffer.substring(sentence.length);

            if (sentence.trim()) {
                const translatedText = await this.translationService.translate(sentence.trim());
                this.audioQueue.push({ text: translatedText });
                this.playNextInQueue();
            }
        }
    }

    public streamEnded() {
        if (this.sentenceBuffer.trim()) {
            this.audioQueue.push({ text: this.sentenceBuffer.trim() });
            this.playNextInQueue();
            this.sentenceBuffer = '';
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
        const { text } = this.audioQueue.shift()!;
        await this.sendSegmentToTts(text);
    }

    public handlePlaybackFinished() {
        this.isPlaying = false;
        this.playNextInQueue();
        // 检查在播放完毕后，队列是否为空，以及流是否已结束（通过buffer判断）
        if (this.audioQueue.length === 0 && this.sentenceBuffer === '') {
             // 延迟发送，确保是最后一条消息
            setTimeout(() => {
                if(this.audioQueue.length === 0 && !this.isPlaying) {
                    this.ipcSender('dialogue-ended');
                }
            }, 100);
        }
    }

    private async sendSegmentToTts(segment: string) {
        try {
            const cleanedSegment = segment.replace(/<[^>]+>/g, '');
            const response = await fetch(this.ttsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: cleanedSegment,
                    text_language: this.language,
                }),
            });

            if (!response.ok) {
                throw new Error(`TTS request failed: ${response.status}`);
            }

            const audioArrayBuffer = await response.arrayBuffer();

            // Send audio data (ArrayBuffer) and text to renderer process for playback
            this.ipcSender('play-audio', { audioArrayBuffer, text: segment, cleanedText: cleanedSegment });

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
    }
}

export { TTSProcessor };
