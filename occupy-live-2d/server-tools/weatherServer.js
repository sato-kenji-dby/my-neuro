// modules/weatherModule.js - 天气查询工具模块

const axios = require('axios');

// OpenWeather API 配置
const OPENWEATHER_API_BASE = "https://api.openweathermap.org/data/2.5/weather";
const API_KEY = "9baee8479333491e3118f3027a8db7bc";
const USER_AGENT = "weather-app/1.0";

// 工具定义
const WEATHER_TOOL = {
    name: "query_weather",
    description: "输入指定城市的英文名称，返回今日天气查询结果。",
    parameters: {
        type: "object",
        properties: {
            city: {
                type: "string",
                description: "城市名称（需使用英文）"
            }
        },
        required: ["city"]
    }
};

// 获取天气数据
async function fetchWeather(city) {
    if (!city) {
        return { error: "请提供有效的城市名称" };
    }

    try {
        const response = await axios.get(OPENWEATHER_API_BASE, {
            params: {
                q: city,
                appid: API_KEY,
                units: "metric",
                lang: "zh_cn"
            },
            headers: {
                "User-Agent": USER_AGENT
            },
            timeout: 30000
        });

        return response.data;
    } catch (error) {
        if (error.response) {
            return { error: `HTTP 错误: ${error.response.status}` };
        }
        return { error: `请求失败: ${error.message}` };
    }
}

// 格式化天气数据
function formatWeather(data) {
    // 如果数据中包含错误信息，直接返回错误提示
    if (data.error) {
        return `⚠️ ${data.error}`;
    }

    // 提取数据时做容错处理
    const city = data.name || "未知";
    const country = data.sys?.country || "未知";
    const temp = data.main?.temp ?? "N/A";
    const humidity = data.main?.humidity ?? "N/A";
    const windSpeed = data.wind?.speed ?? "N/A";
    const weatherList = data.weather || [{}];
    const description = weatherList[0]?.description || "未知";

    return (
        `🌍 ${city}, ${country}\n` +
        `🌡 温度: ${temp}°C\n` +
        `💧 湿度: ${humidity}%\n` +
        `🌬 风速: ${windSpeed} m/s\n` +
        `🌤 天气: ${description}\n`
    );
}

// 模块接口：获取工具定义
function getToolDefinitions() {
    return [WEATHER_TOOL];
}

// 模块接口：执行工具函数
async function executeFunction(name, parameters) {
    if (name !== "query_weather") {
        throw new Error(`此模块不支持工具: ${name}`);
    }

    const city = parameters?.city;
    if (!city) {
        throw new Error("缺少城市参数");
    }

    const weatherData = await fetchWeather(city);
    return formatWeather(weatherData);
}

// 导出模块接口
module.exports = {
    getToolDefinitions,
    executeFunction
};