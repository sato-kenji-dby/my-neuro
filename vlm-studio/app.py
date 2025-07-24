from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Union, Generator, Callable, Dict, Any
import uvicorn
import time
import uuid
import json
import os
import requests
import base64
from PIL import Image
import io

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ollama 配置
OLLAMA_API_URL = os.getenv("OLLAMA_API_URL", "http://localhost:11434/api/generate")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llava") # 默认使用 llava 模型

# 数据模型
class Message(BaseModel):
    role: str
    content: str
    
class ChatRequest(BaseModel):
    model: str
    messages: List[Message]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 512
    stream: Optional[bool] = False
    screenshot_data: Optional[str] = None # Base64 编码的图片数据

# 真正的流式响应生成器函数 (Ollama)
def generate_ollama_stream_response(request: ChatRequest) -> Generator:
    request_id = f"chatcmpl-{str(uuid.uuid4())}"
    created_time = int(time.time())

    try:
        # 准备 Ollama 请求的 messages 格式
        # Ollama 的 generate API 期望的是 prompt 和 images 列表
        # 对于多模态，通常是将图片作为单独的字段传递，而不是在 messages 中
        
        # 提取最后一个用户消息作为主 prompt
        user_prompt = ""
        if request.messages:
            for msg in reversed(request.messages):
                if msg.role == "user":
                    user_prompt = msg.content
                    break
        
        payload = {
            "model": OLLAMA_MODEL,
            "prompt": user_prompt,
            "stream": True # 请求流式响应
        }

        if request.screenshot_data:
            # Ollama 期望的是纯 base64 字符串，不带 "data:image/png;base64," 前缀
            # 如果前端发送的带有前缀，需要在这里处理
            image_base64 = request.screenshot_data
            if "," in image_base64:
                image_base64 = image_base64.split(',')[1]
            payload["images"] = [image_base64]

        headers = {"Content-Type": "application/json"}
        
        # 发送开始事件
        start_event = {
            "id": request_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "delta": {"role": "assistant"},
                    "finish_reason": None
                }
            ]
        }
        yield f"data: {json.dumps(start_event)}\n\n"

        with requests.post(OLLAMA_API_URL, json=payload, headers=headers, stream=True) as response:
            response.raise_for_status()
            for line in response.iter_lines():
                if line:
                    try:
                        json_data = json.loads(line.decode('utf-8'))
                        if "response" in json_data:
                            new_text = json_data["response"]
                            chunk_event = {
                                "id": request_id,
                                "object": "chat.completion.chunk",
                                "created": created_time,
                                "model": request.model,
                                "choices": [
                                    {
                                        "index": 0,
                                        "delta": {"content": new_text},
                                        "finish_reason": None
                                    }
                                ]
                            }
                            yield f"data: {json.dumps(chunk_event)}\n\n"
                        if json_data.get("done"):
                            break # Ollama 发送 done 字段表示结束
                    except json.JSONDecodeError:
                        print(f"Received non-JSON line: {line.decode('utf-8')}")
                        continue

        # 发送结束事件
        end_event = {
            "id": request_id,
            "object": "chat.completion.chunk",
            "created": created_time,
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "delta": {},
                    "finish_reason": "stop"
                }
            ]
        }
        yield f"data: {json.dumps(end_event)}\n\n"
        yield "data: [DONE]\n\n"

    except requests.exceptions.RequestException as e:
        print(f"Ollama API 请求失败: {e}")
        error_event = {
            "error": {
                "message": f"Ollama API request failed: {e}",
                "type": "ollama_api_error"
            }
        }
        yield f"data: {json.dumps(error_event)}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        import traceback
        print(f"流式生成错误 (Ollama): {str(e)}")
        print(traceback.format_exc())
        error_event = {
            "error": {
                "message": str(e),
                "type": "server_error"
            }
        }
        yield f"data: {json.dumps(error_event)}\n\n"
        yield "data: [DONE]\n\n"

# OpenAI兼容的聊天接口 (Ollama)
@app.post("/v1/chat/completions")
async def chat_completion(request: ChatRequest):
    # 检查是否需要流式输出
    if request.stream:
        return StreamingResponse(
            generate_ollama_stream_response(request),
            media_type="text/event-stream"
        )

    # 非流式输出处理 (直接调用 Ollama API)
    try:
        start_time = time.time()

        user_prompt = ""
        if request.messages:
            for msg in reversed(request.messages):
                if msg.role == "user":
                    user_prompt = msg.content
                    break

        payload = {
            "model": OLLAMA_MODEL,
            "prompt": user_prompt,
            "stream": False # 非流式
        }

        if request.screenshot_data:
            image_base64 = request.screenshot_data
            if "," in image_base64:
                image_base64 = image_base64.split(',')[1]
            payload["images"] = [image_base64]

        headers = {"Content-Type": "application/json"}
        response = requests.post(OLLAMA_API_URL, json=payload, headers=headers)
        response.raise_for_status()
        
        ollama_response = response.json()
        response_text = ollama_response.get("response", "")
        
        # Ollama 的非流式响应通常不包含 token 计数，这里可以估算或省略
        # 假设每个字符约 0.25 token (英文)，中文可能不同
        input_tokens = len(user_prompt) / 4 # 粗略估算
        completion_tokens = len(response_text) / 4 # 粗略估算

        end_time = time.time()
        print(f"生成完成，耗时: {end_time - start_time:.2f}秒")

        return {
            "id": f"chatcmpl-{str(uuid.uuid4())}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": request.model,
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": response_text
                    },
                    "finish_reason": "stop"
                }
            ],
            "usage": {
                "prompt_tokens": int(input_tokens),
                "completion_tokens": int(completion_tokens),
                "total_tokens": int(input_tokens + completion_tokens)
            }
        }
    except requests.exceptions.RequestException as e:
        print(f"Ollama API 请求失败: {e}")
        raise HTTPException(status_code=500, detail=f"Ollama API request failed: {e}")
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        print(f"发生错误 (Ollama): {str(e)}")
        print(error_traceback)
        raise HTTPException(status_code=500, detail=str(e))

# 健康检查
@app.get("/health")
async def health():
    return {"status": "ok"}

# 模型列表 (Ollama)
@app.get("/v1/models")
async def list_models():
    # 这里可以尝试从 Ollama API 获取模型列表，但为了简化，先硬编码
    # 实际应用中，可以调用 http://localhost:11434/api/tags 获取
    models_data = [
        {
            "id": OLLAMA_MODEL,
            "object": "model",
            "created": int(time.time()),
            "owned_by": "ollama"
        }
    ]
    return {
        "object": "list",
        "data": models_data
    }

if __name__ == "__main__":
    print("启动 VLM Studio 服务器...")
    uvicorn.run(app, host="0.0.0.0", port=8001, log_level="info") # 使用不同的端口，例如 8001
