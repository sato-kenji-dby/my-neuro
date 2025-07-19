import type { Message } from './voice-chat'; // 导入 Message 类型
import type { TTSProcessor } from './tts-processor'; // 导入 TTSProcessor 类型
import type { MCPClientModule } from './mcp-client-module'; // 导入 MCPClientModule 类型
import { stateManager } from './state-manager'; // 导入 StateManager

interface LLMServiceConfig {
    api_key: string;
    api_url: string;
    model: string;
    provider: string; // 这个字段现在可能不再需要，但暂时保留
    system_prompt: string; // 添加 system_prompt
}

class LLMService {
    private config: LLMServiceConfig;
    private ttsProcessor: TTSProcessor;
    private mcpClientModule: MCPClientModule | undefined;
    private showSubtitle: (text: string, duration: number) => void;
    private hideSubtitle: () => void;
    private logToTerminal: (level: string, message: string) => void;

    constructor(
        config: LLMServiceConfig,
        ttsProcessor: TTSProcessor,
        showSubtitle: (text: string, duration: number) => void,
        hideSubtitle: () => void,
        logToTerminal: (level: string, message: string) => void
    ) {
        this.config = config;
        this.ttsProcessor = ttsProcessor;
        this.showSubtitle = showSubtitle;
        this.hideSubtitle = hideSubtitle;
        this.logToTerminal = logToTerminal;

        // 在构造函数中发送配置到后端
        this.updateBackendConfig();
    }

    setMcpClientModule(mcpClientModule: MCPClientModule) {
        this.mcpClientModule = mcpClientModule;
    }

    private async updateBackendConfig() {
        try {
            const configUpdate = {
                api_key: this.config.api_key,
                model: this.config.model,
                system_prompt: this.config.system_prompt
            };
            this.logToTerminal('info', `Updating LLM backend config at ${this.config.api_url}/update_llm_config`);
            const response = await fetch(`${this.config.api_url}/update_llm_config`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(configUpdate)
            });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(`Failed to update LLM backend config: ${response.status} ${response.statusText} - ${errorData.detail || ''}`);
            }
            this.logToTerminal('info', 'LLM backend config updated successfully.');
        } catch (error: unknown) {
            this.logToTerminal('error', `Error updating LLM backend config: ${(error as Error).message}`);
        }
    }

    async sendToLLM(prompt: string, messages: Message[], systemInstruction: string, screenshotData?: string) {
        try {
            stateManager.isProcessingUserInput = true;
            this.ttsProcessor.reset();

            let fullResponse = "";
            
            // 准备发送到后端的 messages 格式
            const messagesForBackend = messages.map(msg => {
                if (Array.isArray(msg.content)) {
                    // 如果 content 是数组（多模态），需要转换为后端期望的格式
                    const parts = msg.content.map(part => {
                        if (part.type === 'text') {
                            return { text: part.text };
                        } else if (part.type === 'image_url' && part.image_url?.url.startsWith('data:image')) {
                            // 提取 base64 数据
                            const base64Data = part.image_url.url.split(',')[1];
                            return { inline_data: { mime_type: 'image/jpeg', data: base64Data } };
                        }
                        return {}; // Fallback for unsupported parts
                    });
                    return { role: msg.role, parts: parts };
                }
                return { role: msg.role, parts: [{ text: msg.content }] };
            });

            const requestBody: any = {
                model: this.config.model, // 使用配置中的模型名称
                prompt: prompt,
                messages: messagesForBackend,
                system_instruction: systemInstruction, // 仍然从 VoiceChatInterface 传递
                temperature: 0.7, // 可以从 config 中获取或作为参数传递
                stream: true // 默认流式传输
            };

            if (screenshotData) {
                requestBody.screenshot_data = screenshotData;
            }

            // MCP 工具调用逻辑
            if (this.mcpClientModule && this.mcpClientModule.isConnected) {
                const tools = this.mcpClientModule.getToolsForLLM();
                if (tools && tools.length > 0) {
                    requestBody.tools = tools;
                    requestBody.stream = false; // 工具调用不支持流式传输
                }
            }

            this.logToTerminal('info', `开始发送请求到LLM API: ${this.config.api_url}/generate_content`);
            const response = await fetch(`${this.config.api_url}/generate_content`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(requestBody)
            });

            if (!response.ok) {
                let errorMessage = "";
                const errorData = await response.json().catch(() => ({})); // 尝试解析错误响应
                if (errorData.detail) {
                    errorMessage = `API错误: ${response.status} ${response.statusText} - ${errorData.detail}`;
                } else {
                    errorMessage = `API错误: ${response.status} ${response.statusText}`;
                }
                throw new Error(errorMessage);
            }

            if (requestBody.stream) {
                if (!response.body) throw new Error("Response body is null");
                const reader = response.body.getReader();
                const decoder = new TextDecoder("utf-8");

                while (true) {
                    const { value, done } = await reader.read();
                    if (done) {
                        this.ttsProcessor.processTextToSpeech(fullResponse);
                        break;
                    }
                    const text = decoder.decode(value);
                    const lines = text.split('\n');
                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            if (line.includes('[DONE]')) continue;
                            try {
                                const data = JSON.parse(line.slice(6));
                                if (data.text) { // 后端返回的流式数据是 { text: "..." }
                                    const newContent = data.text;
                                    fullResponse += newContent;
                                } else if (data.error) {
                                    throw new Error(`后端流式错误: ${data.error}`);
                                }
                            } catch (e: unknown) {
                                this.logToTerminal('error', `解析响应错误: ${(e as Error).message}`);
                            }
                        }
                    }
                }
            } else { // 非流式响应，处理工具调用或直接回复
                const responseData = await response.json();
                const result = responseData; // 后端直接返回结果，不再是 choices[0].message

                if (result.tool_calls && result.tool_calls.length > 0 && this.mcpClientModule) {
                    this.logToTerminal('info', `检测到工具调用: ${JSON.stringify(result.tool_calls)}`);
                    messages.push({
                        'role': 'assistant',
                        'content': null,
                        'tool_calls': result.tool_calls
                    });
                    this.logToTerminal('info', '开始执行工具调用');
                    const toolResult = await this.mcpClientModule.handleToolCalls(result.tool_calls);
                    if (toolResult) {
                        this.logToTerminal('info', `工具调用结果: ${toolResult}`);
                        messages.push({
                            'role': 'tool',
                            'content': toolResult,
                            'tool_call_id': result.tool_calls[0].id
                        });

                        this.logToTerminal('info', '发送工具结果到LLM获取最终回复');
                        // 重新构建请求体，包含工具结果
                        const finalRequestBody: any = {
                            model: this.config.model,
                            prompt: null, // 工具调用后，prompt 应该为空
                            messages: messages,
                            system_instruction: systemInstruction,
                            temperature: 0.7,
                            stream: false
                        };

                        const finalResponse = await fetch(`${this.config.api_url}/generate_content`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify(finalRequestBody)
                        });

                        if (!finalResponse.ok) {
                            const finalErrorData = await finalResponse.json().catch(() => ({}));
                            throw new Error(`API错误: ${finalResponse.status} ${finalResponse.statusText} - ${finalErrorData.detail || ''}`);
                        }
                        const finalResponseData = await finalResponse.json();
                        const finalResultContent = finalResponseData.text; // 后端直接返回 text 字段
                        this.logToTerminal('info', '获得最终LLM回复，开始语音输出');
                        if (finalResultContent) {
                            fullResponse = finalResultContent;
                            this.ttsProcessor?.reset();
                            this.ttsProcessor?.processTextToSpeech(finalResultContent);
                        }
                    } else {
                        throw new Error("工具调用失败，无法完成功能扩展");
                    }
                } else if (result.text) { // 后端直接返回 text 字段
                    fullResponse = result.text;
                    this.logToTerminal('info', 'LLM直接返回回复，开始语音输出');
                    this.ttsProcessor?.reset();
                    this.ttsProcessor?.processTextToSpeech(result.text);
                }
            }
            return fullResponse;
        } catch (error: unknown) {
            this.logToTerminal('error', `LLM处理错误: ${(error as Error).message}`);
            this.showSubtitle(`抱歉，出现了一个错误: ${(error as Error).message.substring(0, 50)}...`, 3000);
            return null; // Return null instead of re-throwing the error
        } finally {
            stateManager.isProcessingUserInput = false;
        }
    }
}

export { LLMService };
