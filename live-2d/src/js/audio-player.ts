import type { Live2DModel } from 'pixi-live2d-display';

interface AudioPlayerOptions {
    model: Live2DModel;
    onMouthUpdate: (value: number) => void;
    onStart: () => void;
    onEnd: () => void;
    showSubtitle: (text: string) => void;
    hideSubtitle: () => void;
}

class AudioPlayer {
    private model: Live2DModel;
    private onMouthUpdate: (value: number) => void;
    private onStart: () => void;
    private onEnd: () => void;
    private showSubtitle: (text: string) => void;
    private hideSubtitle: () => void;

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
    }

    private async initAudioContext() {
        if (!this.audioContext) {
            this.audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 256;
            this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        }
    }

    public async play(audioDataUrl: string, text: string) {
        await this.initAudioContext();
        this.shouldStop = false;

        if (this.currentAudio) {
            this.interrupt();
        }

        this.onStart();
        this.showSubtitle(`Seraphim: ${text}`);

        this.currentAudio = new Audio(audioDataUrl);
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
        };

        this.currentAudio.play().catch(e => {
            console.error("Audio playback failed:", e);
            this.onEnd();
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
