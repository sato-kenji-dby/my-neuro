import type { TTSProcessor } from './tts-processor'; // 导入 TTSProcessor 类型
import type { AppConfig, MCPConfig, MCPTool } from '$types/global'; // 导入 AppConfig, MCPConfig, MCPTool

// MCP客户端模块 - 集成到AI桌宠系统
class MCPClientModule {
  config: MCPConfig; // 明确类型
  ttsProcessor: TTSProcessor; // 明确类型
  isEnabled: boolean;
  serverUrl: string;
  isConnected: boolean;
  availableTools: MCPTool[]; // 明确类型
  sessionId: string;
  serverInfo: { name: string }; // 明确类型

  constructor(config: AppConfig, ttsProcessor: TTSProcessor) { // 明确参数类型
    // 保存配置和依赖项
    this.config = config.mcp; // 直接使用 config.mcp
    this.ttsProcessor = ttsProcessor;
    this.isEnabled = this.config.enabled;
    this.serverUrl = this.config.server_url;

    // 状态标志
    this.isConnected = false;
    this.availableTools = [];
    this.sessionId = this.generateSessionId();
    this.serverInfo = { name: '未初始化' }; // 初始化 serverInfo

    console.log(`MCP客户端模块已创建，启用状态: ${this.isEnabled}`);
  }

  // 初始化模块
  async initialize(): Promise<boolean> {
    // 添加返回类型
    if (!this.isEnabled) {
      console.log('MCP功能已禁用，不进行初始化');
      return false;
    }

    console.log('正在初始化MCP客户端模块...');
    return await this.discoverMCPTools();
  }

  // 发现可用的MCP工具
  async discoverMCPTools(): Promise<boolean> {
    // 添加返回类型
    try {
      console.log(`尝试连接MCP服务器: ${this.serverUrl}/mcp/v1/discover`);

      const response = await fetch(`${this.serverUrl}/mcp/v1/discover`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: this.sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status}`);
      }

      const data = await response.json();

      // 保存可用工具列表
      this.availableTools = data.functions || [];
      this.serverInfo = data.server || { name: '未知MCP服务器' };
      this.isConnected = true;

      console.log(`已连接到MCP服务器: ${this.serverInfo.name}`);
      console.log(
        `可用工具(${this.availableTools.length}): ${this.availableTools.map((t) => t.name).join(', ')}`
      );

      return true;
    } catch (error: unknown) {
      console.error('MCP服务器连接失败:', (error as Error).message);
      this.isConnected = false;
      return false;
    }
  }

  // 获取工具列表，用于传递给LLM
  getToolsForLLM(): { type: string; function: MCPTool }[] { // 明确返回类型
    if (
      !this.isEnabled ||
      !this.isConnected ||
      this.availableTools.length === 0
    ) {
      return [];
    }

    return this.availableTools.map((tool) => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }));
  }

  // 处理LLM返回的工具调用
  async handleToolCalls(toolCalls: { function: { name: string; arguments: string } }[]): Promise<string | null> { // 明确参数类型和返回类型
    if (
      !this.isEnabled ||
      !this.isConnected ||
      !toolCalls ||
      toolCalls.length === 0
    ) {
      return null;
    }

    const toolCall = toolCalls[0]; // 处理第一个工具调用
    const functionName = toolCall.function.name;

    // 解析参数
    let parameters: object; // 明确类型
    try {
      parameters =
        typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments;
    } catch (error: unknown) {
      console.error('解析工具参数错误:', (error as Error).message);
      parameters = {};
    }

    // 调用MCP工具
    return await this.invokeFunction(functionName, parameters);
  }

  // 调用MCP工具
  async invokeFunction(functionName: string, parameters: object): Promise<string | null> { // 明确参数类型和返回类型
    if (!this.isEnabled || !this.isConnected) {
      console.error('MCP功能未启用或未连接到服务器');
      return null;
    }

    // 查找工具是否存在
    const tool = this.availableTools.find((t) => t.name === functionName);
    if (!tool) {
      console.error(`未找到MCP工具: ${functionName}`);
      return null;
    }

    try {
      console.log(`调用MCP工具: ${functionName}，参数:`, parameters);

      const response = await fetch(`${this.serverUrl}/mcp/v1/invoke`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          session_id: this.sessionId,
          name: functionName,
          parameters: parameters,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status}`);
      }

      const data = await response.json();
      console.log(`MCP工具(${functionName})返回:`, data);

      // 处理返回结果
      return data.result?.content || JSON.stringify(data.result);
    } catch (error: unknown) {
      console.error(`MCP工具调用失败(${functionName}):`, (error as Error).message);
      return null;
    }
  }

  // 生成唯一会话ID
  generateSessionId(): string {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(
      /[xy]/g,
      function (c) {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      }
    );
  }

  // 停止MCP客户端
  stop() {
    this.isConnected = false;
    console.log('MCP客户端已停止');
  }
}

export { MCPClientModule };
