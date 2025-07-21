import type { Live2DModel } from 'pixi-live2d-display';
import type { Application, InteractionEvent } from 'pixi.js';

// 定义一个只包含我们需要的 ipcRenderer 方法的接口
interface MinimalIpcRenderer {
  send(channel: string, ...args: unknown[]): void;
}

class ModelInteractionController {
  private ipcRenderer: MinimalIpcRenderer | null = null;
  private model: Live2DModel | null = null; // 直接使用 Live2DModel
  private app: Application | null = null;
  private interactionWidth: number = 0;
  private interactionHeight: number = 0;
  private interactionX: number = 0;
  private interactionY: number = 0;
  private isDragging: boolean = false;
  private isDraggingChat: boolean = false;
  private dragOffset: { x: number; y: number } = { x: 0, y: 0 };
  private chatDragOffset: { x: number; y: number } = { x: 0, y: 0 };

  constructor() {}

  // 初始化模型和应用
  init(model: Live2DModel, app: Application, ipcRenderer: MinimalIpcRenderer) {
    this.model = model;
    this.app = app;
    this.ipcRenderer = ipcRenderer;
    this.updateInteractionArea();
    this.setupInteractivity();
  }

  // 更新交互区域大小和位置
  updateInteractionArea() {
    if (!this.model) return;

    this.interactionWidth = this.model.width / 3;
    this.interactionHeight = this.model.height * 0.7;
    this.interactionX =
      this.model.x + (this.model.width - this.interactionWidth) / 2;
    this.interactionY =
      this.model.y + (this.model.height - this.interactionHeight) / 2;
  }

  // 鼠标释放事件处理
  private handleMouseUp = () => {
    this.isDragging = false;
  };

  // 鼠标滚轮事件处理（缩放功能）
  private handleWheel = (e: WheelEvent) => {
    if (
      this.model &&
      this.app &&
      this.model.containsPoint(
        this.app.renderer.plugins.interaction.mouse.global
      )
    ) {
      e.preventDefault();

      const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
      const currentScale = this.model.scale.x;
      const newScale = currentScale * scaleChange;

      const minScale = this.model.scale.x * 0.3;
      const maxScale = this.model.scale.x * 3.0;

      if (newScale >= minScale && newScale <= maxScale) {
        this.model.scale.set(newScale);

        const oldWidth = this.model.width / scaleChange;
        const oldHeight = this.model.height / scaleChange;
        const deltaWidth = this.model.width - oldWidth;
        const deltaHeight = this.model.height - oldHeight;

        this.model.x -= deltaWidth / 2;
        this.model.y -= deltaHeight / 2;
        this.updateInteractionArea();
      }
    }
  };

  // 窗口大小改变事件处理
  private handleResize = () => {
    if (this.app && this.app.renderer) {
      this.app.renderer.resize(window.innerWidth * 2, window.innerHeight * 2);
      this.app.stage.position.set(
        window.innerWidth / 2,
        window.innerHeight / 2
      );
      this.app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);
      this.updateInteractionArea();
    }
  };

  // 设置交互性
  setupInteractivity() {
    if (!this.model || !this.app) return; // 确保 model 和 app 都存在

    this.model.interactive = true;

    // 鼠标按下事件
    this.model.on('mousedown', (e: InteractionEvent) => {
      const point = e.data.global;
      if (this.model && this.model.containsPoint(point)) {
        this.isDragging = true;
        this.dragOffset.x = point.x - this.model.x;
        this.dragOffset.y = point.y - this.model.y;
      }
    });

    // 鼠标移动事件
    this.model.on('mousemove', (e: InteractionEvent) => {
      if (this.isDragging) {
        const newX = e.data.global.x - this.dragOffset.x;
        const newY = e.data.global.y - this.dragOffset.y;
        this.model?.position.set(newX, newY);
        this.updateInteractionArea();
      }
    });

    // 全局鼠标释放事件
    window.addEventListener('mouseup', this.handleMouseUp);

    // 鼠标悬停事件
    this.model.on('mouseover', () => {
      if (this.ipcRenderer && !window.appInfo.isDevelopment) {
        // 仅在非开发模式下发送
        this.ipcRenderer.send('request-set-ignore-mouse-events', {
          ignore: false,
        });
      }
    });

    // 鼠标离开事件
    this.model.on('mouseout', () => {
      if (this.ipcRenderer && !window.appInfo.isDevelopment) {
        // 仅在非开发模式下发送
        this.ipcRenderer.send('request-set-ignore-mouse-events', {
          ignore: true,
        });
      }
    });

    // 鼠标点击事件
    this.model.on('click', () => {
      if (
        this.model &&
        this.app &&
        this.model.containsPoint(
          this.app.renderer.plugins.interaction.mouse.global
        ) &&
        this.model.internalModel
      ) {
        this.model.motion?.('Tap');
        this.model.expression?.();

        // 新增：通过 IPC 通知主进程模型被点击
        if (this.ipcRenderer) {
          this.ipcRenderer.send('model-clicked');
        }
      }
    });

    // 鼠标滚轮事件（缩放功能）
    window.addEventListener('wheel', this.handleWheel, { passive: false });

    // 窗口大小改变事件
    window.addEventListener('resize', this.handleResize);
  }

  // 设置嘴部动画
  setMouthOpenY(v: number) {
    // 添加类型
    if (!this.model) return;

    try {
      v = Math.max(0, Math.min(v, 3.0));
      const paramId = 'ParamMouthOpenY';
      if (
        this.model &&
        this.model.internalModel &&
        this.model.internalModel.coreModel
      ) {
        const coreModel: InstanceType<
          Window['Live2DCubismCore']['Live2DModel']
        > = this.model.internalModel.coreModel as InstanceType<
          Window['Live2DCubismCore']['Live2DModel']
        >;
        coreModel.setParameterValueById(paramId, v);
      }
    } catch (error) {
      console.error('设置嘴型参数失败:', error);
    }
  }

  // 销毁方法，移除所有事件监听器
  destroy() {
    if (this.model) {
      // 移除 PIXI 模型的事件监听器
      this.model.off('mousedown');
      this.model.off('mousemove');
      this.model.off('mouseover');
      this.model.off('mouseout');
      this.model.off('click');
    }
    // 移除全局 window 事件监听器
    window.removeEventListener('mouseup', this.handleMouseUp);
    window.removeEventListener('wheel', this.handleWheel);
    window.removeEventListener('resize', this.handleResize);

    this.model = null;
    this.app = null;
    this.ipcRenderer = null;
  }

  // 初始化模型位置和大小
  setupInitialModelProperties(scaleMultiplier = 1.0) {
    // 调整默认缩放乘数，使其更容易看到
    if (!this.model || !this.app) return;

    // 计算一个合适的初始缩放，使模型可见
    const initialScale = Math.min(
      (window.innerWidth * scaleMultiplier) / this.model.width,
      (window.innerHeight * scaleMultiplier) / this.model.height
    );
    this.model.scale.set(initialScale);

    // 将模型放置在屏幕中央
    this.model.x = (window.innerWidth - this.model.width * initialScale) / 2;
    this.model.y = (window.innerHeight - this.model.height * initialScale) / 2;
    this.updateInteractionArea();
  }
}

export { ModelInteractionController };
