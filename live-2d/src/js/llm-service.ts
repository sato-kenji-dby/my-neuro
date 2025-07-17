import { ipcRenderer } from 'electron';
import { GoogleGenAI, createUserContent, createPartFromUri } from "@google/genai";
import { SocksProxyAgent } from 'socks-proxy-agent';
import fetch from 'node-fetch';
import type { Message } from './voice-chat'; // 导入 Message 类型
import type { TTSProcessor } from './tts-processor'; // 导入 TTSProcessor 类型
import type { MCPClientModule } from './mcp-client-module'; // 导入 MCPClientModule 类型
import { stateManager } from './state-manager'; // 导入 StateManager

interface LLMServiceConfig {
    api_key: string;
    api_url: string;
    model: string;
    provider: string;
}

class LLMService {
    private config: LLMServiceConfig;
    private ai: GoogleGenAI | null = null;
    private chat: any = null; // GoogleGenerativeAI.ChatSession 类型，暂时用 any
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

        if (this.config.provider === 'google_aistudio') {
            // 创建一个SOCKS代理
            const agent = new SocksProxyAgent('socks://127.0.0.1:10808');
            
            // 创建一个自定义的 fetch 实现
            const customFetch = (url: any, options: any) => {
                // @ts-ignore
                return fetch(url, { ...options, agent });
            };

            this.ai = new GoogleGenAI({ 
                apiKey: this.config.api_key,
                // @ts-ignore
                transport: {
                    fetch: customFetch
                }
            });

            this.chat = this.ai.chats.create({
                model: this.config.model,
                history: [],
            });
        }
    }

    setMcpClientModule(mcpClientModule: MCPClientModule) {
        this.mcpClientModule = mcpClientModule;
    }

    async sendToLLM(prompt: string, messages: Message[], systemInstruction: string, screenshotData?: string) {
        try {
            stateManager.isProcessingUserInput = true;
            this.ttsProcessor.reset();

            let fullResponse = "";
            let messagesForAPI = JSON.parse(JSON.stringify(messages));

            if (this.config.provider === 'google_aistudio') {
                if (!this.ai || !this.chat) {
                    throw new Error("Google AI Studio not initialized");
                }
                try {
                    let result;
                    if (screenshotData) {
                        this.logToTerminal('info', '需要截图');
                        if (!this.ai) throw new Error("Google AI not initialized for file upload.");
                        const image = await this.ai.files.upload({
                            file: screenshotData, // screenshotData 已经是 base64 字符串
                        });
                        this.logToTerminal('info', "上传截图成功:" + image.uri);

                        const config_pic_contents = [
                            createUserContent([
                                prompt,
                                createPartFromUri(image.uri!, image.mimeType!),
                            ]),
                        ];
                        result = await this.ai.models.generateContentStream({
                            model: this.config.model,
                            contents: config_pic_contents,
                            config: {
                                systemInstruction: systemInstruction,
                            },
                        });
                    } else {
                        const config = {
                            message: prompt,
                            config: {
                                systemInstruction: systemInstruction,
                            }
                        };
                        result = await this.chat.sendMessageStream(config);
                    }

                    for await (const chunk of result.stream) {
                        const chunkText = chunk.text();
                        fullResponse += chunkText;
                        this.ttsProcessor.addStreamingText(chunkText);
                        this.logToTerminal('info', chunkText);
                    }

                    if (screenshotData) {
                        const config_reminder = {
                            message: "刚才我向你询问了一张图片有关：" + prompt + "。你的回答是:" + fullResponse,
                            config: {
                                systemInstruction: systemInstruction,
                            }
                        };
                        await this.chat.sendMessage(config_reminder);
                        this.logToTerminal('info', "reminder used");
                    }
                } catch (error: unknown) {
                    this.logToTerminal('error', `Google AI Studio error: ${(error as Error).message}`);
                    this.showSubtitle((error as Error).message, 3000);
                    throw error;
                }
            } else {
                if (screenshotData) {
                    const lastUserMsgIndex = messagesForAPI.findIndex(
                        (msg: Message) => msg.role === 'user' && msg.content === prompt
                    );
                    if (lastUserMsgIndex !== -1) {
                        messagesForAPI[lastUserMsgIndex] = {
                            'role': 'user',
                            'content': [
                                {'type': 'text', 'text': prompt},
                                {'type': 'image_url', 'image_url': {'url': `data:image/jpeg;base64,${screenshotData}`}}
                            ]
                        };
                    }
                }

                const requestBody: any = {
                    model: this.config.model,
                    messages: messagesForAPI,
                    stream: true
                };

                if (this.mcpClientModule && this.mcpClientModule.isConnected) {
                    const tools = this.mcpClientModule.getToolsForLLM();
                    if (tools && tools.length > 0) {
                        requestBody.tools = tools;
                        requestBody.stream = false; // 工具调用不支持流式传输
                    }
                }

                this.logToTerminal('info', `开始发送请求到LLM API: ${this.config.api_url}/chat/completions`);
                const response = await fetch(`${this.config.api_url}/chat/completions`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.config.api_key}`
                    },
                    body: JSON.stringify(requestBody)
                });

                if (!response.ok) {
                    let errorMessage = "";
                    switch(response.status) {
                        case 401: errorMessage = "API密钥验证失败，请检查你的API密钥"; break;
                        case 403: errorMessage = "API访问被禁止，你的账号可能被限制"; break;
                        case 404: errorMessage = "API接口未找到，请检查API地址"; break;
                        case 429: errorMessage = "请求过于频繁，超出API限制"; break;
                        case 500: case 502: case 503: case 504: errorMessage = "服务器错误，AI服务当前不可用"; break;
                        default: errorMessage = `API错误: ${response.status} ${response.statusText}`;
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
                            this.ttsProcessor.finalizeStreamingText();
                            break;
                        }
                        const text = decoder.decode(value);
                        const lines = text.split('\n');
                        for (const line of lines) {
                            if (line.startsWith('data: ')) {
                                if (line.includes('[DONE]')) continue;
                                try {
                                    const data = JSON.parse(line.slice(6));
                                    if (data.choices[0].delta.content) {
                                        const newContent = data.choices[0].delta.content;
                                        fullResponse += newContent;
                                        this.ttsProcessor.addStreamingText(newContent);
                                    }
                                } catch (e: unknown) {
                                    this.logToTerminal('error', `解析响应错误: ${(e as Error).message}`);
                                }
                            }
                        }
                    }
                } else { // 非流式响应，处理工具调用
                    const responseData = await response.json();
                    const result = responseData.choices[0].message;

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
                            const finalResponse = await fetch(`${this.config.api_url}/chat/completions`, {
                                method: 'POST',
                                headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${this.config.api_key}`
                                },
                                body: JSON.stringify({
                                    model: this.config.model,
                                    messages: messages,
                                    stream: false
                                })
                            });

                            if (!finalResponse.ok) {
                                throw new Error(`API错误: ${finalResponse.status} ${finalResponse.statusText}`);
                            }
                            const finalResponseData = await finalResponse.json();
                            const finalResult = finalResponseData.choices[0].message;
                            this.logToTerminal('info', '获得最终LLM回复，开始语音输出');
                            if (finalResult.content) {
                                fullResponse = finalResult.content;
                                this.ttsProcessor?.reset();
                                this.ttsProcessor?.processTextToSpeech(finalResult.content);
                            }
                        } else {
                            throw new Error("工具调用失败，无法完成功能扩展");
                        }
                    } else if (result.content) {
                        fullResponse = result.content;
                        this.logToTerminal('info', 'LLM直接返回回复，开始语音输出');
                        this.ttsProcessor?.reset();
                        this.ttsProcessor?.processTextToSpeech(result.content);
                    }
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
