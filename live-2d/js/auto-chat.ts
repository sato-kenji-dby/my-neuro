// 自动对话模块 - 完全同步版本，支持自动截图
declare var require: any; // For CommonJS require in Electron context
declare var Buffer: any;  // For Buffer in Node.js context

declare global {
    var isProcessingBarrage: boolean;
    var isPlayingTTS: boolean;
    var isProcessingUserInput: boolean;
    var voiceChat: any;
    var mcpClientModule: any;
}

class AutoChatModule {
   config: any;
   ttsProcessor: any; // 假设 ttsProcessor 是 TTSProcessor 类的实例
   timeoutId: number | null; // setInterval 返回 number
   isRunning: boolean;
   enabled: boolean;
   idleTimeThreshold: number;
   lastInteractionTime: number;
   isProcessing: boolean;

   autoScreenshot: boolean;
   screenshotEnabled: boolean;
   screenshotPath: string;

   constructor(config: any, ttsProcessor: any) { // 添加参数类型
       this.config = config;
       this.ttsProcessor = ttsProcessor;
       this.timeoutId = null;
       this.isRunning = false;
       this.enabled = config.auto_chat.enabled;
       this.idleTimeThreshold = config.auto_chat.idle_time || config.auto_chat.max_interval;
       this.lastInteractionTime = Date.now();
       this.isProcessing = false;

       // 新增：自动截图相关配置
       this.autoScreenshot = config.vision?.auto_screenshot || false;
       this.screenshotEnabled = config.vision?.enabled || false;
       this.screenshotPath = config.vision?.screenshot_path || '~/Desktop/screenshot.jpg';
   }

   start() {
       if (!this.enabled || this.isRunning) return;

       console.log(`自动对话启动，间隔：${this.idleTimeThreshold}ms`);
       this.isRunning = true;
       this.lastInteractionTime = Date.now();
       this.scheduleNext();
   }

   stop() {
       if (this.timeoutId) {
           clearTimeout(this.timeoutId);
           this.timeoutId = null;
       }
       this.isRunning = false;
       this.isProcessing = false;
   }

   scheduleNext() {
       if (!this.isRunning) return;

       this.timeoutId = setTimeout(() => {
           this.executeChat();
       }, this.idleTimeThreshold) as unknown as number; // 添加类型断言
   }

   // 新增：截图功能
   async takeScreenshot(): Promise<string> { // 添加返回类型
       try {
           const { ipcRenderer } = require('electron');
           const filepath = await ipcRenderer.invoke('take-screenshot', this.screenshotPath);
           console.log('自动对话截图已保存:', filepath);
           return filepath;
       } catch (error) {
           console.error('自动对话截图错误:', error);
           throw error;
       }
   }

   // 新增：图片转base64
   async imageToBase64(imagePath: string): Promise<string> { // 添加参数和返回类型
       return new Promise<string>((resolve, reject) => { // 修正 Promise 类型
           const fs = require('fs');
           fs.readFile(imagePath, (err: any, data: Buffer) => { // 添加类型
               if (err) {
                   console.error('读取图片失败:', err);
                   reject(err);
                   return;
               }
               const base64Image = Buffer.from(data).toString('base64');
               resolve(base64Image);
           });
       });
   }

   async executeChat() {
       if (!this.isRunning || this.isProcessing) return;

       // 检查其他活动
       if (global.isPlayingTTS || global.isProcessingBarrage || global.isProcessingUserInput) {
           console.log('有其他活动，延迟5秒重试');
           this.timeoutId = setTimeout(() => this.executeChat(), 5000) as unknown as number; // 添加类型断言
           return;
       }

       this.isProcessing = true;
       console.log('开始自动对话');

       try {
           const voiceChat = global.voiceChat; // 假设 global.voiceChat 存在且类型正确
           if (!voiceChat) {
               console.error('voiceChat不存在');
               return;
           }

           const prompt = "当你看到这条消息的：你就会触发主动功能。自己和自己对话。就是完完全全的自己做事情。你可以使用我给你设置的工具，同时你要记住，本消息并不是用户给你发送的，而是系统。所以你不需要假装和用户交流。而是可以理解为自己给自己做事情。不要尝试去和什么人说话！！！现在除了你自己，周围没有如何的人！！！！！所以不要用和别人在聊天的语气说话谈论东西！！！！不要反问！！因为没有人在和你说话！同时要说出你具体要做哪些事情，不能没有前后逻辑！如果想要用工具就必须得用！！不能不用！不能说了不用！最后要记得让自己开心。要给自己定一个计划。按照这个计划行动。同时要记住每次只能用一个工具，所以不能在一个回合使用多个工具。最后要记得有一个主线不要随便乱做事情，说话。同时工具的使用只能在开头，不能在结尾。所以如果想用工具只能在开头使用，或者这次说完想用什么工具，然后再下一次的回合开头使用。不要假装使用工具，假装使用工具是绝对不可以的操作！！！这是绝对禁止的行为！这是欺骗行为，禁止假装使用工具！禁止在一次对话使用多个工具，一次对话里只能使用一次工具";

           // 添加到消息历史
           voiceChat.messages.push({
               'role': 'user',
               'content': `[自动触发] ${prompt}`
           });

           if (voiceChat.enableContextLimit) {
               voiceChat.trimMessages();
           }

           // 准备API请求消息数组
           let messagesForAPI = JSON.parse(JSON.stringify(voiceChat.messages));

           // 新增：检查是否需要截图（自动截图或智能判断）
           let needScreenshot = false;
           if (this.screenshotEnabled) {
               if (this.autoScreenshot) {
                   console.log('自动截图模式已开启，主动对话将包含截图');
                   needScreenshot = true;
               }
               // 这里也可以添加智能判断逻辑，比如调用vision check API
           }

           // 新增：如果需要截图，处理多模态消息
           if (needScreenshot) {
               try {
                   console.log("主动对话需要截图");
                   const screenshotPath = await this.takeScreenshot();
                   const base64Image = await this.imageToBase64(screenshotPath);

                   // 找到最后一条用户消息（自动触发消息）并替换为多模态消息
                   const lastUserMsgIndex = messagesForAPI.length - 1;
                   if (messagesForAPI[lastUserMsgIndex].role === 'user') {
                       messagesForAPI[lastUserMsgIndex] = {
                           'role': 'user',
                           'content': [
                               {'type': 'text', 'text': messagesForAPI[lastUserMsgIndex].content},
                               {'type': 'image_url', 'image_url': {'url': `data:image/jpeg;base64,${base64Image}`}}
                           ]
                       };
                   }
               } catch (error) {
                   console.error("主动对话截图处理失败:", error);
                   // 截图失败，继续使用纯文本消息
               }
           }

           // 准备API请求
           const requestBody: { model: any; messages: any; stream: boolean; tools?: any[] } = { // 明确类型以允许 tools
               model: voiceChat.MODEL,
               messages: messagesForAPI,
               stream: false
           };

           // 添加工具列表（如果可用）
           if (global.mcpClientModule && global.mcpClientModule.isConnected) {
               const tools = global.mcpClientModule.getToolsForLLM();
               if (tools && tools.length > 0) {
                   requestBody.tools = tools;
               }
           }

           // 1. 调用LLM
           console.log('调用LLM...');
           const response = await fetch(`${voiceChat.API_URL}/chat/completions`, {
               method: 'POST',
               headers: {
                   'Content-Type': 'application/json',
                   'Authorization': `Bearer ${voiceChat.API_KEY}`
               },
               body: JSON.stringify(requestBody)
           });

           if (!response.ok) throw new Error(`LLM错误: ${response.status}`);

           const result = await response.json();
           const message = result.choices[0].message;

           // 2. 如果有工具调用，执行工具
           if (message.tool_calls?.length > 0 && global.mcpClientModule) {
               console.log('执行工具调用...');

               voiceChat.messages.push({
                   'role': 'assistant',
                   'content': null,
                   'tool_calls': message.tool_calls
               });

               const toolResult = await global.mcpClientModule.handleToolCalls(message.tool_calls);
               console.log('工具调用完成');

               voiceChat.messages.push({
                   'role': 'tool',
                   'content': toolResult,
                   'tool_call_id': message.tool_calls[0].id
               });

               // 3. 再次调用LLM获取最终回复
               console.log('获取最终回复...');
               const finalResponse = await fetch(`${voiceChat.API_URL}/chat/completions`, {
                   method: 'POST',
                   headers: {
                       'Content-Type': 'application/json',
                       'Authorization': `Bearer ${voiceChat.API_KEY}`
                   },
                   body: JSON.stringify({
                       model: voiceChat.MODEL,
                       messages: voiceChat.messages,
                       stream: false
                   })
               });

               if (!finalResponse.ok) throw new Error(`最终LLM错误: ${finalResponse.status}`);

               const finalResult = await finalResponse.json();
               const finalMessage = finalResult.choices[0].message;

               if (finalMessage.content) {
                   voiceChat.messages.push({'role': 'assistant', 'content': finalMessage.content});

                   // 4. 播放TTS并等待完成
                   console.log('开始TTS播放...');
                   await this.waitForTTS(finalMessage.content);
                   console.log('TTS播放完成');
               }
           } else if (message.content) {
               // 没有工具调用，直接TTS
               voiceChat.messages.push({'role': 'assistant', 'content': message.content});

               console.log('开始TTS播放...');
               await this.waitForTTS(message.content);
               console.log('TTS播放完成');
           }

           if (voiceChat.enableContextLimit) {
               voiceChat.trimMessages();
           }

           console.log('自动对话完成');

       } catch (error) {
           console.error('自动对话错误:', error);
       } finally {
           this.isProcessing = false;
           // 对话完成后，安排下一次
           this.scheduleNext();
       }
   }

   // 等待TTS播放完成
   waitForTTS(content: string) { // 添加类型
       return new Promise<void>((resolve) => { // 修正 Promise 类型
           console.log('设置TTS结束回调，等待播放完成...');

           const originalEndCallback = this.ttsProcessor.onEndCallback;

           this.ttsProcessor.onEndCallback = () => {
               console.log('TTS播放结束回调被触发');
               this.ttsProcessor.onEndCallback = originalEndCallback;
               if (originalEndCallback) originalEndCallback();
               resolve();
           };

           console.log('开始TTS播放:', content.substring(0, 50) + '...');
           this.ttsProcessor.reset();
           this.ttsProcessor.processTextToSpeech(content);
       });
   }

   updateLastInteractionTime() {
       this.lastInteractionTime = Date.now();
       if (this.timeoutId) {
           clearTimeout(this.timeoutId);
           this.scheduleNext();
       }
   }
}

export { AutoChatModule };
