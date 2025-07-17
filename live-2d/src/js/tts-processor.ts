import { TranslationService } from './translation-service';

class TTSProcessor {
    private config: any;
    private ttsUrl: string;
    private language: string;
    private translationService: TranslationService;
    private ipcSender: (channel: string, ...args: any[]) => void;

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
        
        // Simple text segmentation
        const segments = translatedText.split(/([,。，？！；;：:])/g);
        let tempSegment = "";
        for (let i = 0; i < segments.length; i++) {
            tempSegment += segments[i];
            if (i % 2 === 1 || i === segments.length - 1) {
                if (tempSegment.trim()) {
                    this.sendSegmentToTts(tempSegment.trim());
                }
                tempSegment = "";
            }
        }
    }

    private async sendSegmentToTts(segment: string) {
        try {
            const response = await fetch(this.ttsUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: segment,
                    text_language: this.language,
                }),
            });

            if (!response.ok) {
                throw new Error(`TTS request failed: ${response.status}`);
            }

            const audioBlob = await response.blob();
            const audioDataUrl = await this.blobToDataURL(audioBlob);

            // Send audio data and text to renderer process for playback
            this.ipcSender('play-audio', { audioDataUrl, text: segment });

        } catch (error) {
            console.error('TTS segment processing error:', error);
        }
    }

    private blobToDataURL(blob: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    public addStreamingText(text: string) {
        // This method will be simplified or moved to the renderer process
        // For now, we just send the raw text to be handled by the frontend player
        this.ipcSender('stream-text', { text });
    }

    public finalizeStreamingText() {
        this.ipcSender('finalize-stream');
    }

    public interrupt() {
        this.ipcSender('interrupt-playback');
    }

    public reset() {
        this.interrupt();
    }
}

export { TTSProcessor };
