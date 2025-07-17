import { ipcRenderer } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { ASRProcessor } from './asr-processor';
import type { Live2DModel } from 'pixi-live2d-display'; // 导入 Live2DModel 类型
import type { TTSProcessor } from './tts-processor'; // 导入 TTSProcessor 类型
import type { EmotionMotionMapper } from './emotion-motion-mapper'; // 导入 EmotionMotionMapper 类型
import { stateManager } from './state-manager'; // 导入 StateManager
import type { LLMService } from './llm-service'; // 导入 LLMService 类型
import type { ScreenshotService } from './screenshot-service'; // 导入 ScreenshotService 类型

// 定义配置接口
interface VoiceChatConfig {
    context: {
        max_messages: number;
        enable_limit: boolean;
    };
    memory: {
        file_path: string;
        check_url: string;
    };
    llm: { // 仍然需要 llm 配置来获取 system_prompt
        system_prompt: string;
    };
}

// 定义消息接口
export interface Message { // 导出 Message 接口
    role: 'system' | 'user' | 'assistant' | 'tool'; // 添加 'tool' 角色
    content: string | null | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }>;
    tool_calls?: any[]; // 添加 tool_calls
    tool_call_id?: string; // 添加 tool_call_id
}

class VoiceChatInterface {
    private config: VoiceChatConfig;
    private ttsProcessor: TTSProcessor;
    private llmService: LLMService; // 添加 LLMService 实例
    private screenshotService: ScreenshotService; // 添加 ScreenshotService 实例
    private showSubtitle: (text: string, duration: number) => void;
    private hideSubtitle: () => void;
    public asrProcessor: ASRProcessor;
    private maxContextMessages: number;
    public enableContextLimit: boolean;
    private memoryFilePath: string;
    private memoryCheckUrl: string;
    public model: Live2DModel | null = null;
    public emotionMapper: EmotionMotionMapper | null = null;
    public messages: Message[];
    private asrLocked: boolean = false;

    constructor(
        vadUrl: string,
        asrUrl: string,
        ttsProcessor: TTSProcessor,
        llmService: LLMService, // 接收 LLMService 实例
        screenshotService: ScreenshotService, // 接收 ScreenshotService 实例
        showSubtitle: (text: string, duration: number) => void,
        hideSubtitle: () => void,
        config: VoiceChatConfig
    ) {
        this.config = config;
        this.ttsProcessor = ttsProcessor;
        this.llmService = llmService;
        this.screenshotService = screenshotService;
        this.showSubtitle = showSubtitle;
        this.hideSubtitle = hideSubtitle;
        
        this.asrProcessor = new ASRProcessor(vadUrl, asrUrl);
        
        this.maxContextMessages = this.config.context.max_messages;
        this.enableContextLimit = this.config.context.enable_limit;
        
        this.memoryFilePath = this.config.memory.file_path;
        this.memoryCheckUrl = this.config.memory.check_url;

        this.model = null;
        this.emotionMapper = null;

        const dialogLogPath = path.join(__dirname, '..', '对话记录.txt');
        try {
            if (!fs.existsSync(dialogLogPath)) {
                fs.writeFileSync(dialogLogPath, '', 'utf8');
            }

            const currentDate = new Date().toISOString().split('T')[0];
            const sessionStart = `=== 新会话开始：${currentDate} ===\n`;
            fs.appendFileSync(dialogLogPath, sessionStart, 'utf8');
            console.log('对话记录文件已准备好');
        } catch (error: unknown) {
            console.error('准备对话记录文件失败:', (error as Error).message);
        }

        let memoryContent = "";
        try {
            memoryContent = fs.readFileSync(this.memoryFilePath, 'utf8');
            console.log('成功读取记忆库内容');
        } catch (error: unknown) {
            console.error('读取记忆库文件失败:', (error as Error).message);
            memoryContent = "无法读取记忆库内容";
        }

        const baseSystemPrompt = this.config.llm.system_prompt;

        const systemPrompt = `${baseSystemPrompt}这些数据里面是有关用户的各种信息。你可以观测，在必要的时候参考这些内容，正常普通的对话不要提起：
${memoryContent}`;

        this.messages = [
            {
                'role': 'system',
                'content': systemPrompt
            }
        ];

        // 监听 ASRProcessor 的 speech-recognized 事件
        this.asrProcessor.on('speech-recognized', async (text: string) => {
            this.showSubtitle(`用户: ${text}`, 3000);

            stateManager.isProcessingUserInput = true;

            try {
                const needMemory = await this.checkMessageForMemory(text);
                if (needMemory) {
                    await this.saveToMemory(text);
                    console.log('用户消息已保存到记忆库');
                } else {
                    console.log('用户消息不需要保存到记忆库');
                }

                await this.sendToLLM(text);
            } finally {
                stateManager.isProcessingUserInput = false;

                const lastUserMsg = this.messages.filter(m => m.role === 'user').pop();
                const lastAIMsg = this.messages.filter(m => m.role === 'assistant').pop();

                if (lastUserMsg && lastAIMsg) {
                    const newContent = `【用户】: ${lastUserMsg.content}\n【Seraphim】: ${lastAIMsg.content}\n`;

                    try {
                        fs.appendFileSync(
                            path.join(__dirname, '..', '对话记录.txt'),
                            newContent,
                            'utf8'
                        );
                    } catch (error: unknown) {
                        console.error('保存对话记录失败:', (error as Error).message);
                    }
                }
            }
        });
    }

    // 设置模型
    setModel(model: Live2DModel) {
        this.model = model;
        console.log('模型已设置到VoiceChat');
    }

    // 设置情绪动作映射器
    setEmotionMapper(emotionMapper: EmotionMotionMapper) {
        this.emotionMapper = emotionMapper;
        console.log('情绪动作映射器已设置到VoiceChat');
    }

    // 检查消息是否需要记忆
    async checkMessageForMemory(text: string) {
        try {
            const response = await fetch(`${this.memoryCheckUrl}?text=${encodeURIComponent(text)}`, {
                method: 'POST'
            });

            if (!response.ok) {
                throw new Error('记忆检查API请求失败');
            }

            const data = await response.json();
            console.log('记忆检查结果:', data);
            return data["需要检索"] === "是";
        } catch (error: unknown) {
            console.error('记忆检查错误:', (error as Error).message);
            return false;
        }
    }

    // 保存消息到记忆文件
    async saveToMemory(text: string) {
        try {
            const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
            const memoryEntry = `[${timestamp}] ${text}\n`;

            fs.appendFileSync(this.memoryFilePath, memoryEntry, 'utf8');
            console.log('已保存到记忆文件:', text);
            return true;
        } catch (error: unknown) {
            console.error('保存记忆失败:', (error as Error).message);
            return false;
        }
    }

    // 暂停录音
    async pauseRecording() {
        this.asrProcessor.pauseRecording();
        console.log('Recording paused due to TTS playback');
    }

    // 恢复录音
    async resumeRecording() {
        this.asrProcessor.resumeRecording();
        console.log('Recording resumed after TTS playback, ASR unlocked');
    }

    // 设置上下文限制
    setContextLimit(enable: boolean) {
        this.enableContextLimit = enable;
        if (enable) {
            this.trimMessages();
        }
    }

    // 设置最大上下文消息数
    setMaxContextMessages(count: number) {
        if (count < 1) throw new Error('最大消息数不能小于1');
        this.maxContextMessages = count;
        if (this.enableContextLimit) {
            this.trimMessages();
        }
    }

    // 裁剪消息 - 修复上下文复读问题
    trimMessages() {
        if (!this.enableContextLimit) return;

        // 获取系统消息（始终保留）
        const systemMessages = this.messages.filter(msg => msg.role === 'system');

        // 获取非系统消息（可能需要裁剪）
        const nonSystemMessages = this.messages.filter(msg => msg.role !== 'system');

        // 调试日志
        console.log(`裁剪前: 系统消息 ${systemMessages.length} 条, 非系统消息 ${nonSystemMessages.length} 条`);

        // 只保留最新的 maxContextMessages 条非系统消息
        const recentMessages = nonSystemMessages.slice(-this.maxContextMessages);

        // 重构消息数组
        this.messages = [...systemMessages, ...recentMessages];

        console.log(`裁剪后: 消息总数 ${this.messages.length} 条, 非系统消息 ${recentMessages.length} 条`);
    }

    // 开始录音
    async startRecording() {
        await this.asrProcessor.startRecording();
    }

    // 停止录音
    stopRecording() {
        this.asrProcessor.stopRecording();
    }

    // 发送消息到LLM
    async sendToLLM(prompt: string) {
        try {
            // 保存用户消息到上下文（只保存文本）
            this.messages.push({'role': 'user', 'content': prompt});

            // 先进行裁剪，确保只保留最新的消息
            if (this.enableContextLimit) {
                this.trimMessages();
            }

            const systemInstruction = this.messages.find(m => m.role === 'system')?.content;
            if (typeof systemInstruction !== 'string') {
                throw new Error("System prompt is not a string or not found.");
            }

            let screenshotData: string | undefined;
            const needScreenshot = await this.screenshotService.shouldTakeScreenshot(prompt);
            if (needScreenshot) {
                const screenshotPath = await this.screenshotService.takeScreenshot();
                screenshotData = await this.screenshotService.imageToBase64(screenshotPath);
            }

            const fullResponse = await this.llmService.sendToLLM(
                prompt,
                this.messages,
                systemInstruction,
                screenshotData
            );

            if (fullResponse) {
                this.messages.push({ 'role': 'assistant', 'content': fullResponse });
                if (this.enableContextLimit) {
                    this.trimMessages();
                }
            }
        } catch (error: unknown) {
            console.error("LLM处理错误:", (error as Error).message);
            this.showSubtitle(`抱歉，出现了一个错误: ${(error as Error).message.substring(0, 50)}...`, 3000);
            this.asrProcessor.resumeRecording();
            setTimeout(() => this.hideSubtitle(), 3000);
        } finally {
            stateManager.isProcessingUserInput = false;
        }
    }
}

export { VoiceChatInterface };
