import type { Live2DModel } from 'pixi-live2d-display';
import type { Application } from 'pixi.js';

// 定义一个只包含我们需要的 ipcRenderer 方法的接口
interface MinimalIpcRenderer {
  send(channel: string, ...args: any[]): void;
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

    this.interactionWidth = (this.model as any).width / 3; // 类型断言
    this.interactionHeight = (this.model as any).height * 0.7; // 类型断言
    this.interactionX =
      (this.model as any).x +
      ((this.model as any).width - this.interactionWidth) / 2; // 类型断言
    this.interactionY =
      (this.model as any).y +
      ((this.model as any).height - this.interactionHeight) / 2; // 类型断言
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
      (this.model as any).containsPoint(
        this.app.renderer.plugins.interaction.mouse.global
      )
    ) {
      // 类型断言
      e.preventDefault();

      const scaleChange = e.deltaY > 0 ? 0.9 : 1.1;
      const currentScale = (this.model as any).scale.x; // 类型断言
      const newScale = currentScale * scaleChange;

      const minScale = (this.model as any).scale.x * 0.3; // 类型断言
      const maxScale = (this.model as any).scale.x * 3.0; // 类型断言

      if (newScale >= minScale && newScale <= maxScale) {
        (this.model as any).scale.set(newScale); // 类型断言

        const oldWidth = (this.model as any).width / scaleChange; // 类型断言
        const oldHeight = (this.model as any).height / scaleChange; // 类型断言
        const deltaWidth = (this.model as any).width - oldWidth; // 类型断言
        const deltaHeight = (this.model as any).height - oldHeight; // 类型断言

        (this.model as any).x -= deltaWidth / 2; // 类型断言
        (this.model as any).y -= deltaHeight / 2; // 类型断言
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

    (this.model as any).interactive = true; // 类型断言

    // 鼠标按下事件
    (this.model as any).on('mousedown', (e: any) => {
      // 类型断言
      const point = e.data.global;
      if (this.model && (this.model as any).containsPoint(point)) {
        // 类型断言
        this.isDragging = true;
        this.dragOffset.x = point.x - (this.model as any).x; // 类型断言
        this.dragOffset.y = point.y - (this.model as any).y; // 类型断言
      }
    });

    // 鼠标移动事件
    (this.model as any).on('mousemove', (e: any) => {
      // 类型断言
      if (this.isDragging) {
        const newX = e.data.global.x - this.dragOffset.x;
        const newY = e.data.global.y - this.dragOffset.y;
        (this.model as any).position.set(newX, newY); // 类型断言
        this.updateInteractionArea();
      }
    });

    // 全局鼠标释放事件
    window.addEventListener('mouseup', this.handleMouseUp);

    // 鼠标悬停事件
    (this.model as any).on('mouseover', () => {
      if (this.ipcRenderer && !window.appInfo.isDevelopment) {
        // 仅在非开发模式下发送
        this.ipcRenderer.send('request-set-ignore-mouse-events', {
          ignore: false,
        });
      }
    });

    // 鼠标离开事件
    (this.model as any).on('mouseout', () => {
      if (this.ipcRenderer && !window.appInfo.isDevelopment) {
        // 仅在非开发模式下发送
        this.ipcRenderer.send('request-set-ignore-mouse-events', {
          ignore: true,
        });
      }
    });

    // 鼠标点击事件
    (this.model as any).on('click', () => {
      // 类型断言
      if (
        this.model &&
        this.app &&
        (this.model as any).containsPoint(
          this.app.renderer.plugins.interaction.mouse.global
        ) &&
        (this.model as any).internalModel
      ) {
        // 类型断言
        (this.model as any).motion('Tap'); // 类型断言
        (this.model as any).expression(); // 类型断言

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
        (this.model as any).internalModel &&
        (this.model as any).internalModel.coreModel
      ) {
        // 添加空值检查和类型断言
        const coreModel: any = (this.model as any).internalModel.coreModel; // 类型断言为 any
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
      (this.model as any).off('mousedown');
      (this.model as any).off('mousemove');
      (this.model as any).off('mouseover');
      (this.model as any).off('mouseout');
      (this.model as any).off('click');
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
      (window.innerWidth * scaleMultiplier) / (this.model as any).width,
      (window.innerHeight * scaleMultiplier) / (this.model as any).height
    );
    (this.model as any).scale.set(initialScale); // 类型断言

    // 将模型放置在屏幕中央
    (this.model as any).x =
      (window.innerWidth - (this.model as any).width * initialScale) / 2; // 类型断言
    (this.model as any).y =
      (window.innerHeight - (this.model as any).height * initialScale) / 2; // 类型断言
    this.updateInteractionArea();
  }
}

export { ModelInteractionController };
