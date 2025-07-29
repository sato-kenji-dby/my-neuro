from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Optional
import uvicorn
import os
import base64
import io
import json

# 导入 Gemini API 客户端
from google import genai
from google.genai import types

# --- 配置 ---
# 不再需要全局客户端，将在每个请求中动态创建
print("VLM 服务已启动，将在每次请求时使用提供的 API Key 初始化客户端。")

# --- FastAPI 应用 ---
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 数据模型 ---
class VLMRequest(BaseModel):
    prompt: str
    screenshot_data: str  # Base64 编码的图片数据
    api_key: str          # 从前端接收 API Key
    model: Optional[str] = "gemini-1.5-flash"

# --- API 端点 ---
@app.post("/describe_image")
async def describe_image(request: VLMRequest):
    if not request.api_key:
        raise HTTPException(status_code=400, detail="请求中未提供 API Key。")

    try:
        # 1. 使用请求中提供的 API Key 动态初始化客户端
        try:
            client = genai.Client(api_key=request.api_key)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"使用提供的 API Key 初始化 Gemini 客户端失败: {e}")

        # 2. 解码图片
        try:
            image_bytes = base64.b64decode(request.screenshot_data)
        except Exception as e:
            print(f"解码 Base64 图片时出错: {e}")
            raise HTTPException(status_code=400, detail=f"无效的图片数据: {e}")

        # 2. 根据官方文档，将图片字节构造成 types.Part
        image_part = types.Part.from_bytes(
            data=image_bytes,
            mime_type='image/jpeg' # 假设截图是jpeg格式
        )

        # 3. 准备发送到 Gemini 的内容列表
        # 列表可以包含文本和图片 Part
        contents = [request.prompt, image_part]

        # 4. 使用 client.models.generate_content 调用 Gemini API
        response = client.models.generate_content(
            model=request.model,
            contents=contents
        )

        # 5. 返回纯文本结果
        return {"description": response.text}

    except Exception as e:
        print(f"调用 Gemini API 时发生错误: {e}")
        raise HTTPException(status_code=500, detail=f"与 VLM 模型交互时出错: {e}")

# --- 健康检查 ---
@app.get("/health")
async def health():
    # 由于客户端是动态创建的，健康检查只确认服务正在运行
    return {"status": "ok"}

# --- 主程序入口 ---
if __name__ == "__main__":
    print("启动 VLM Studio 服务器...")
    # 端口改为 8001 以避免与 LLM Studio 冲突
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info")
