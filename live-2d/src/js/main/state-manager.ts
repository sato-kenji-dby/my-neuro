class StateManager {
  private listeners: { [key: string]: Function[] } = {};
  private _isProcessingUserInput: boolean = false;
  private _isPlayingTTS: boolean = false;
  private _isProcessingBarrage: boolean = false;

  constructor() {
    // No super() call needed for custom event emitter
  }

  // Custom event emitter methods
  on(event: string, callback: Function) {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);
    // 返回一个取消订阅的函数
    return () => {
      this.off(event, callback);
    };
  }

  off(event: string, callback: Function) {
    // 新增 off 方法
    if (this.listeners[event]) {
      this.listeners[event] = this.listeners[event].filter(
        (listener) => listener !== callback
      );
    }
  }

  emit(event: string, ...args: any[]) {
    const eventListeners = this.listeners[event];
    if (eventListeners) {
      // 遍历副本，以防在迭代过程中修改数组
      [...eventListeners].forEach((listener) => listener(...args));
    }
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
    return (
      this._isProcessingUserInput ||
      this._isPlayingTTS ||
      this._isProcessingBarrage
    );
  }
}

// 导出单例
export const stateManager = new StateManager();
