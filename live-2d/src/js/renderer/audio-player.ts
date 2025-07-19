import type { Live2DModel } from 'pixi-live2d-display';
import type { ExposedIpcRenderer } from '$types/ipc'; // 新增导入

interface AudioPlayerOptions {
    model: Live2DModel;
    onMouthUpdate: (value: number) => void;
    onStart: () => void;
    onEnd: () => void;
    showSubtitle: (text: string, duration: number) => void; // 增加 duration 参数
    hideSubtitle: () => void;
    ipcRenderer: ExposedIpcRenderer;
}

class AudioPlayer {
    private model: Live2DModel;
    private onMouthUpdate: (value: number) => void;
    private onStart: () => void;
    private onEnd: () => void;
    private showSubtitle: (text: string, duration: number) => void; // 增加 duration 参数
    private hideSubtitle: () => void;
    private ipcRenderer: ExposedIpcRenderer;

    private audioContext: AudioContext | null = null;
    private analyser: AnalyserNode | null = null;
    private dataArray: Uint8Array | null = null;
    private currentAudio: HTMLAudioElement | null = null;
    private shouldStop: boolean = false;

    constructor(options: AudioPlayerOptions) {
        this.model = options.model;
        this.onMouthUpdate = options.onMouthUpdate;
        this.onStart = options.onStart;
        this.onEnd = options.onEnd;
        this.showSubtitle = options.showSubtitle;
        this.hideSubtitle = options.hideSubtitle;
        this.ipcRenderer = options.ipcRenderer; // 赋值
    }

    private async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
    }

    public async play(audioArrayBuffer: ArrayBuffer, text: string, cleanedText: string) {
        await this.initAudioContext();
        this.shouldStop = false;

        if (this.currentAudio) {
            this.interrupt();
        }

        this.onStart();

        // 解码音频以获取时长
        const audioBuffer = await this.audioContext!.decodeAudioData(audioArrayBuffer.slice(0));
        const duration = audioBuffer.duration;

        this.showSubtitle(`Seraphim: ${cleanedText}`, duration);

        // 将 ArrayBuffer 转换为 Blob
        const audioBlob = new Blob([audioArrayBuffer], { type: 'audio/wav' });
        const audioUrl = URL.createObjectURL(audioBlob);

        this.currentAudio = new Audio(audioUrl);
        const source = this.audioContext!.createMediaElementSource(this.currentAudio);
        source.connect(this.analyser!);
        this.analyser!.connect(this.audioContext!.destination);

        const updateMouth = () => {
            if (this.shouldStop || !this.currentAudio) return;
            this.analyser!.getByteFrequencyData(this.dataArray!);
            const average = this.dataArray!.reduce((a, b) => a + b) / this.dataArray!.length;
            const mouthOpenValue = Math.pow(average / 128, 0.8);
            this.onMouthUpdate(mouthOpenValue);
            requestAnimationFrame(updateMouth);
        };

        this.currentAudio.onplay = () => {
            updateMouth();
        };

        this.currentAudio.onended = () => {
            this.onMouthUpdate(0);
            this.onEnd();
            setTimeout(() => this.hideSubtitle(), 1000);
            this.currentAudio = null;
            URL.revokeObjectURL(audioUrl); // 释放 Blob URL

            // 新增：通知主进程 TTS 播放完成
            this.ipcRenderer.send('tts-playback-finished');
        };

        this.currentAudio.play().catch(e => {
            console.error("Audio playback failed:", e);
            this.onEnd();
            URL.revokeObjectURL(audioUrl); // 释放 Blob URL
        });
    }

    public interrupt() {
        this.shouldStop = true;
        if (this.currentAudio) {
            this.currentAudio.pause();
            this.currentAudio.onended = null;
            this.currentAudio = null;
        }
        this.onMouthUpdate(0);
        this.hideSubtitle();
        this.onEnd();
    }
}

export { AudioPlayer };
