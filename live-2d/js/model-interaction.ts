import { ipcRenderer } from 'electron';
import type { Live2DModel } from 'pixi-live2d-display';
import type { Application, Point } from 'pixi.js';

// 声明 Live2DCubismCore 全局变量为 any，因为没有 @types 包且复杂声明可能导致问题
declare var Live2DCubismCore: any;

class ModelInteractionController {
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
    init(model: Live2DModel, app: Application) { // 移除 ExtendedLive2DModel
        this.model = model;
        this.app = app;
        this.updateInteractionArea();
        this.setupInteractivity();
    }

    // 更新交互区域大小和位置
    updateInteractionArea() {
        if (!this.model) return;
        
        this.interactionWidth = (this.model as any).width / 3; // 类型断言
        this.interactionHeight = (this.model as any).height * 0.7; // 类型断言
        this.interactionX = (this.model as any).x + ((this.model as any).width - this.interactionWidth) / 2; // 类型断言
        this.interactionY = (this.model as any).y + ((this.model as any).height - this.interactionHeight) / 2; // 类型断言
    }

    // 设置交互性
    setupInteractivity() {
        if (!this.model || !this.app) return; // 确保 model 和 app 都存在
        
        (this.model as any).interactive = true; // 类型断言

        // 覆盖原始的containsPoint方法，自定义交互区域
        const originalContainsPoint = (this.model as any).containsPoint; // 类型断言
        (this.model as any).containsPoint = (point: Point): boolean => { // 类型断言
            
            const isOverModel = (
                this.model && // 确保模型已加载
                (this.model as any).x >= this.interactionX && // 类型断言
                (this.model as any).x <= this.interactionX + this.interactionWidth && // 类型断言
                (this.model as any).y >= this.interactionY && // 类型断言
                (this.model as any).y <= this.interactionY + this.interactionHeight // 类型断言
            );

            // // 检查是否在聊天框内
            const chatContainer = document.getElementById('text-chat-container');
            if (!chatContainer) return isOverModel as boolean; // 确保返回 boolean

            // 获取PIXI应用的view(DOM canvas元素)
            if (!this.app || !this.app.renderer || !this.app.renderer.view) return isOverModel as boolean; // 确保返回 boolean
            const pixiView = this.app.renderer.view;
    
            // 计算canvas在页面中的位置
            const canvasRect = pixiView.getBoundingClientRect();
    
            // 获取聊天框的DOM位置
            const chatRect = chatContainer.getBoundingClientRect();
    
            // 将DOM坐标转换为PIXI坐标
            const chatLeftInPixi = (chatRect.left - canvasRect.left) * (pixiView.width / canvasRect.width);
            const chatRightInPixi = (chatRect.right - canvasRect.left) * (pixiView.width / canvasRect.width);
            const chatTopInPixi = (chatRect.top - canvasRect.top) * (pixiView.height / canvasRect.height);
            const chatBottomInPixi = (chatRect.bottom - canvasRect.top) * (pixiView.height / canvasRect.height);

            // const chatRect = chatContainer.getBoundingClientRect();
            const isOverChat = (
                point.x >= chatLeftInPixi &&
                point.x <= chatRightInPixi &&
                point.y >= chatTopInPixi &&
                point.y <= chatBottomInPixi
            );

            
            return isOverModel || isOverChat;
        };
        

        // 鼠标按下事件
        (this.model as any).on('mousedown', (e: any) => { // 类型断言
            const point = e.data.global;
            if (this.model && (this.model as any).containsPoint(point)) { // 类型断言
                this.isDragging = true;
                this.dragOffset.x = point.x - (this.model as any).x; // 类型断言
                this.dragOffset.y = point.y - (this.model as any).y; // 类型断言
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
            
        });

        // 鼠标移动事件
        (this.model as any).on('mousemove', (e: any) => { // 类型断言
            if (this.isDragging) {
                const newX = e.data.global.x - this.dragOffset.x;
                const newY = e.data.global.y - this.dragOffset.y;
                (this.model as any).position.set(newX, newY); // 类型断言
                this.updateInteractionArea();
            }
        });

        // 全局鼠标释放事件
        window.addEventListener('mouseup', () => {
            if (this.isDragging) {
                this.isDragging = false;
                setTimeout(() => {
                    if (this.model && this.app && !(this.model as any).containsPoint(this.app.renderer.plugins.interaction.mouse.global)) { // 添加空值检查和类型断言
                        ipcRenderer.send('set-ignore-mouse-events', {
                            ignore: true,
                            options: { forward: true }
                        });
                    }
                }, 100);
            }
        });

        const chatContainer = document.getElementById('text-chat-container');
        if (!chatContainer) return; // 添加空值检查

        // 鼠标按下时开始拖动
        chatContainer.addEventListener('mousedown', (e) => {
            // 仅当点击聊天框背景或消息区域时触发拖动（避免误触输入框和按钮）
            const target = e.target as HTMLElement; // 类型断言
            if (target === chatContainer || target.id === 'chat-messages') {
                this.isDraggingChat = true;
                this.chatDragOffset.x = e.clientX - chatContainer.getBoundingClientRect().left;
                this.chatDragOffset.y = e.clientY - chatContainer.getBoundingClientRect().top;
                e.preventDefault(); // 防止文本选中
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
                
            }
        });

        // 鼠标移动时更新位置
        document.addEventListener('mousemove', (e) => {
            if (this.isDraggingChat) {
                chatContainer.style.left = `${e.clientX - this.chatDragOffset.x}px`;
                chatContainer.style.top = `${e.clientY - this.chatDragOffset.y}px`;
            }
        });

        // 鼠标释放时停止拖动
        document.addEventListener('mouseup', () => {
            // this.isDraggingChat = false;
            if (this.isDraggingChat) {
                this.isDraggingChat = false;
                setTimeout(() => {
                    if (this.model && this.app && !(this.model as any).containsPoint(this.app.renderer.plugins.interaction.mouse.global)) { // 添加空值检查和类型断言
                        ipcRenderer.send('set-ignore-mouse-events', {
                            ignore: true,
                            options: { forward: true }
                        });
                    }
                }, 100);
            }
        });


// 拖动结束时，再次检查穿透状态
// window.addEventListener('mouseup', () => {
//     if (this.isDraggingChat) {
//         this.isDraggingChat = false;
//         this.updateMouseIgnore(); // 确保拖动结束后状态正确
//     }
// });

// 鼠标离开事件
// document.addEventListener('mouseout', () => {
//     if (!this.isDraggingChat) {
//         ipcRenderer.send('set-ignore-mouse-events', {
//             ignore: true,
//             options: { forward: true }
//         });
//     }
// });

        // 鼠标悬停事件
        (this.model as any).on('mouseover', () => { // 类型断言
            if (this.model && this.app && (this.model as any).containsPoint(this.app.renderer.plugins.interaction.mouse.global)) { // 类型断言
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: false
                });
            }
        });

        // 鼠标离开事件
        (this.model as any).on('mouseout', () => { // 类型断言
            if (!this.isDragging) {
                ipcRenderer.send('set-ignore-mouse-events', {
                    ignore: true,
                    options: { forward: true }
                });
            }
        });

        // 鼠标点击事件
        (this.model as any).on('click', () => { // 类型断言
            if (this.model && this.app && (this.model as any).containsPoint(this.app.renderer.plugins.interaction.mouse.global) && (this.model as any).internalModel) { // 类型断言
                (this.model as any).motion("Tap"); // 类型断言
                (this.model as any).expression(); // 类型断言
            }
        });

        // 鼠标滚轮事件（缩放功能）
        window.addEventListener('wheel', (e) => {
            if (this.model && this.app && (this.model as any).containsPoint(this.app.renderer.plugins.interaction.mouse.global)) { // 类型断言
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
        }, { passive: false });

        // 窗口大小改变事件
        window.addEventListener('resize', () => {
            if (this.app && this.app.renderer) {
                this.app.renderer.resize(window.innerWidth * 2, window.innerHeight * 2);
                this.app.stage.position.set(window.innerWidth / 2, window.innerHeight / 2);
                this.app.stage.pivot.set(window.innerWidth / 2, window.innerHeight / 2);
                this.updateInteractionArea();
            }
        });
    }

    // 设置嘴部动画
    setMouthOpenY(v: number) { // 添加类型
        if (!this.model) return;
        
        try {
            v = Math.max(0, Math.min(v, 3.0));
            const paramId = 'ParamMouthOpenY';
            if (this.model && (this.model as any).internalModel && (this.model as any).internalModel.coreModel) { // 添加空值检查和类型断言
                const coreModel: any = (this.model as any).internalModel.coreModel; // 类型断言为 any
                coreModel.setParameterValueById(paramId, v);
            }
        } catch (error) {
            console.error('设置嘴型参数失败:', error);
        }
    }

    // 初始化模型位置和大小
    setupInitialModelProperties(scaleMultiplier = 2.3) {
        if (!this.model || !this.app) return;
        
        const scaleX = (window.innerWidth * scaleMultiplier) / (this.model as any).width; // 类型断言
        const scaleY = (window.innerHeight * scaleMultiplier) / (this.model as any).height; // 类型断言
        (this.model as any).scale.set(Math.min(scaleX, scaleY)); // 类型断言

        (this.model as any).y = window.innerHeight * 0.8; // 类型断言
        (this.model as any).x = window.innerWidth * 1.35; // 类型断言
        this.updateInteractionArea();
    }
}

export { ModelInteractionController };
