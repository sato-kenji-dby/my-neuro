// modules/animeImageModule.js - 动漫图片工具模块

const axios = require('axios');

// 工具定义
const ANIME_IMAGE_TOOL = {
    name: "get_anime_image",
    description: "获取随机二次元图片",
    parameters: {
        type: "object",
        properties: {
            image_type: {
                type: "string",
                description: "图片类型，可选值为 \"pc\"(电脑格式) 或 \"wap\"(手机格式)",
                enum: ["pc", "wap"]
            }
        }
    }
};

// 获取随机二次元图片
async function getAnimeImage(imageType = 'pc') {
    const url = 'https://v2.xxapi.cn/api/randomAcgPic';
    const params = {
        type: imageType
    };
    const headers = {
        'user-agent': 'xiaoxiaoapi/1.0.0 (https://xxapi.cn)'
    };

    try {
        const response = await axios.get(url, {
            headers: headers,
            params: params
        });

        return response.data;
    } catch (error) {
        console.error('获取动漫图片失败:', error);
        return { error: `请求失败: ${error.message}` };
    }
}

// 模块接口：获取工具定义
function getToolDefinitions() {
    return [ANIME_IMAGE_TOOL];
}

// 模块接口：执行工具函数
async function executeFunction(name, parameters) {
    if (name !== "get_anime_image") {
        throw new Error(`此模块不支持工具: ${name}`);
    }

    const imageType = parameters?.image_type || 'pc';
    const imageData = await getAnimeImage(imageType);

    // 处理API返回格式
    if (imageData.error) {
        return `⚠️ ${imageData.error}`;
    } else if (imageData.data && typeof imageData.data === 'string' && imageData.data.includes('xxapi.cn')) {
        // API实际返回格式是data字段
        return `📷 随机二次元图片链接: ${imageData.data}`;
    } else if (imageData.imgurl) {
        // 兼容可能的imgurl字段
        return `📷 随机二次元图片链接: ${imageData.imgurl}`;
    } else {
        // 无法识别的格式
        console.log("无法识别的API返回格式:", imageData);
        return `⚠️ 无法识别的图片API返回格式`;
    }
}

// 导出模块接口
module.exports = {
    getToolDefinitions,
    executeFunction
};