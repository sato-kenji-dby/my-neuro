// noteServer.js - 普通记录工具

const fs = require('fs');
const path = require('path');

// 文件路径 - 保存在上一级目录
const RECORDS_FILE = path.join(process.cwd(), '..', 'notes_database.txt');

// 工具定义 - 重要信息记录
const NOTE_TOOL = {
    name: "record_note",
    description: "当遇到想要记录的内容，可以使用此工具记录下内容",
    parameters: {
        type: "object",
        properties: {
            content: {
                type: "string",
                description: "要记录的内容"
            }
        },
        required: ["content"]
    }
};

// 获取简化的日期 (只到天)
function getSimpleDate() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    return `${year}年${month}月${day}日`;
}

// 保存重要信息到文件
async function saveNote(content) {
    try {
        // 获取简化日期
        const date = getSimpleDate();
        
        // 格式化笔记
        const note = `[${date}] 普通记录: ${content}\n\n`;
        
        // 检查文件是否存在，不存在则创建
        if (!fs.existsSync(RECORDS_FILE)) {
            fs.writeFileSync(RECORDS_FILE, '', 'utf8');
        }
        
        // 追加笔记到文件
        fs.appendFileSync(RECORDS_FILE, note, 'utf8');
        
        return {
            success: true,
            file: RECORDS_FILE
        };
    } catch (error) {
        console.error('保存笔记错误:', error);
        throw error;
    }
}

// 模块接口：获取工具定义
function getToolDefinitions() {
    return [NOTE_TOOL];
}

// 模块接口：执行工具函数
async function executeFunction(name, parameters) {
    // 处理重要信息记录
    if (name === "record_note") {
        const content = parameters?.content;
        if (!content || content.trim() === '') {
            throw new Error("记录内容不能为空");
        }
        
        try {
            await saveNote(content);
            return `✅ 已记录到notes_database.txt文件`;
        } catch (error) {
            return `⚠️ 记录失败: ${error.message}`;
        }
    }
    
    // 未知工具
    else {
        throw new Error(`此模块不支持工具: ${name}`);
    }
}

// 导出模块接口
module.exports = {
    getToolDefinitions,
    executeFunction
};