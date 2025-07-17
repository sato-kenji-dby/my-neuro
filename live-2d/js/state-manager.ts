import { EventEmitter } from 'events';

class StateManager extends EventEmitter {
    private _isProcessingUserInput: boolean = false;
    private _isPlayingTTS: boolean = false;
    private _isProcessingBarrage: boolean = false;

    constructor() {
        super();
    }

    get isProcessingUserInput(): boolean {
        return this._isProcessingUserInput;
    }

    set isProcessingUserInput(value: boolean) {
        if (this._isProcessingUserInput !== value) {
            this._isProcessingUserInput = value;
            this.emit('state-change:isProcessingUserInput', value);
            console.log(`StateManager: isProcessingUserInput 变为 ${value}`);
        }
    }

    get isPlayingTTS(): boolean {
        return this._isPlayingTTS;
    }

    set isPlayingTTS(value: boolean) {
        if (this._isPlayingTTS !== value) {
            this._isPlayingTTS = value;
            this.emit('state-change:isPlayingTTS', value);
            console.log(`StateManager: isPlayingTTS 变为 ${value}`);
        }
    }

    get isProcessingBarrage(): boolean {
        return this._isProcessingBarrage;
    }

    set isProcessingBarrage(value: boolean) {
        if (this._isProcessingBarrage !== value) {
            this._isProcessingBarrage = value;
            this.emit('state-change:isProcessingBarrage', value);
            console.log(`StateManager: isProcessingBarrage 变为 ${value}`);
        }
    }

    // 辅助方法：检查是否有任何活动正在进行
    get isAnyActivityInProgress(): boolean {
        return this._isProcessingUserInput || this._isPlayingTTS || this._isProcessingBarrage;
    }
}

// 导出单例
export const stateManager = new StateManager();
