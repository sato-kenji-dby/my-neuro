from fastapi import FastAPI, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from typing import List, Optional, Union, Generator, Callable, Dict, Any
import uvicorn
import time
import uuid
import json
import torch
import os
from transformers import AutoModelForCausalLM, AutoTokenizer
from transformers import TextIteratorStreamer
from threading import Thread
import base64
from PIL import Image
import io

# 导入 Gemini API 客户端
from google import genai
from google.genai import types

# 从环境变量获取 API 密钥
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY") 
if GEMINI_API_KEY:
    gemini_client = genai.Client(api_key=GEMINI_API_KEY)
else:
    print("GEMINI_API_KEY environment variable not set. Gemini API will not be available.")
    gemini_client = None

# 模型路径配置 - 如果为空字符串则进行自动检测
MODEL_PATH = ""  # 可以直接在这里硬编码路径，例如："models/你的LLM模型"

# 获取模型路径 - 自动检测或使用硬编码路径
def get_model_path():
    # 如果MODEL_PATH已设置，则使用这个路径
    if MODEL_PATH:
        print(f"使用硬编码的模型路径: {MODEL_PATH}")
        return MODEL_PATH
    
    # 否则自动检测
    models_dir = "models"
    if not os.path.exists(models_dir):
        raise FileNotFoundError(f"模型目录 '{models_dir}' 不存在")
    
    # 获取models目录下的所有文件夹
    subdirs = [d for d in os.listdir(models_dir) if os.path.isdir(os.path.join(models_dir, d))]
    
    if not subdirs:
        raise FileNotFoundError(f"模型目录 '{models_dir}' 下没有找到任何模型文件夹")
    
    # 使用第一个检测到的文件夹
    model_folder = subdirs[0]
    model_path = os.path.join(models_dir, model_folder)
    
    print(f"已自动检测到模型文件夹: {model_folder}")
    return model_path

# 初始化模型和分词器
model = None
tokenizer = None
try:
    print("正在加载本地模型...")
    model_dir = get_model_path()
    model = AutoModelForCausalLM.from_pretrained(
        model_dir,
        device_map='auto',
        torch_dtype='auto'
    )
    tokenizer = AutoTokenizer.from_pretrained(model_dir)
    print(f"本地模型加载完成! 使用模型路径: {model_dir}")
except Exception as e:
    print(f"本地模型加载失败: {str(e)}. 如果您只使用云端API，这可能是正常的。")
    # 如果本地模型加载失败，不阻止应用启动，但会记录错误

# FastAPI应用
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 数据模型 (用于本地模型)
class Message(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: List[Message]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 512
    stream: Optional[bool] = False

# 数据模型 (用于 Gemini API)
class GenerateContentRequest(BaseModel):
    model: str # 添加 model 字段，用于区分模型
    prompt: Optional[str] = None
    messages: Optional[List[Dict[str, Any]]] = None # 完整的对话历史
    system_instruction: Optional[str] = None
    temperature: Optional[float] = None
    thinking_budget: Optional[int] = None
    screenshot_data: Optional[str] = None # Base64 编码的图片数据

# 新增：LLM 配置更新模型
class LLMConfigUpdate(BaseModel):
    api_key: Optional[str] = None
    model: Optional[str] = None
    system_prompt: Optional[str] = None # 用于更新默认的系统提示

# 新增：翻译请求模型
class TranslateRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str
    prompt: str

# 全局变量，用于存储 LLM 配置
current_llm_config = {
    "api_key": GEMINI_API_KEY,
    "model": "gemini-2.5-flash", # 默认模型
    "system_prompt": "你是一个有用的AI助手。" # 默认系统提示
}

# 真正的流式响应生成器函数 (本地模型)
def generate_real_stream_response(request: ChatRequest) -> Generator:
    if model is None or tokenizer is None:
        yield f"data: {json.dumps({'error': 'Local model not loaded.'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    try:
        request_id = f"chatcmpl-{str(uuid.uuid4())}"
        created_time = int(time.time())

        # 准备消息
        messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]

        # 应用聊天模板
        text = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=False
        )

        # 准备模型输入
        model_inputs = tokenizer([text], return_tensors='pt').to(model.device)
        input_length = len(model_inputs.input_ids[0])

        # 创建流式迭代器
        streamer = TextIteratorStreamer(tokenizer, skip_prompt=True, skip_special_tokens=True)

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

        # 在后台线程中运行生成过程
        generation_kwargs = {
            **model_inputs,
            "streamer": streamer,
            "max_new_tokens": request.max_tokens,
            "temperature": request.temperature if request.temperature > 0 else 1.0,
        }

        thread = Thread(target=model.generate, kwargs=generation_kwargs)
        thread.start()

        # 实时获取并发送生成的tokens
        for new_text in streamer:
            if new_text:
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

    except Exception as e:
        import traceback
        print(f"流式生成错误 (本地模型): {str(e)}")
        print(traceback.format_exc())
        # 在出错时发送错误事件
        error_event = {
            "error": {
                "message": str(e),
                "type": "server_error"
            }
        }
        yield f"data: {json.dumps(error_event)}\n\n"
        yield "data: [DONE]\n\n"


# OpenAI兼容的聊天接口 (本地模型)
@app.post("/v1/chat/completions")
async def chat_completion(request: ChatRequest):
    if model is None or tokenizer is None:
        return JSONResponse(status_code=500, content={"error": "Local model not loaded."})

    # 检查是否需要流式输出
    if request.stream:
        return StreamingResponse(
            generate_real_stream_response(request),
            media_type="text/event-stream"
        )

    # 非流式输出处理
    try:
        start_time = time.time()

        # 准备消息
        messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]

        # 应用聊天模板
        text = tokenizer.apply_chat_template(
            messages,
            add_generation_prompt=True,
            tokenize=False
        )

        # 准备模型输入
        model_inputs = tokenizer([text], return_tensors='pt').to(model.device)

        # 计算输入token数
        input_tokens = len(model_inputs.input_ids[0])

        # 生成文本
        with torch.no_grad():
            generated_ids = model.generate(
                **model_inputs,
                max_new_tokens=request.max_tokens,
                temperature=request.temperature if request.temperature > 0 else 1.0
            )

        # 提取生成的内容
        generated_ids = [
            output_ids[len(input_ids):] for input_ids, output_ids in zip(model_inputs.input_ids, generated_ids)
        ]

        # 解码回复
        response_text = tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0]

        # 计算生成token数
        completion_tokens = len(generated_ids[0])

        end_time = time.time()
        print(f"生成完成，耗时: {end_time - start_time:.2f}秒")

        # 返回OpenAI兼容格式
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
                "prompt_tokens": input_tokens,
                "completion_tokens": completion_tokens,
                "total_tokens": input_tokens + completion_tokens
            }
        }
    except Exception as e:
        import traceback
        error_traceback = traceback.format_exc()
        print(f"发生错误 (本地模型): {str(e)}")
        print(error_traceback)
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": error_traceback})


# Gemini API 兼容的文本生成接口
@app.post("/generate_content")
async def generate_content(request_data: GenerateContentRequest):
    if gemini_client is None:
        raise HTTPException(status_code=503, detail="Gemini API key not set, Gemini API is not available.")

    try:
        model_name = request_data.model # 从请求中获取模型名称

        contents = []
        
        # 处理对话历史
        if request_data.messages:
            for msg in request_data.messages:
                role = msg.get("role")
                # 过滤掉 system 角色消息，因为 system_instruction 会单独处理
                if role == 'system':
                    continue

                parts = []
                for part in msg.get("parts", []):
                    if part.get("text"):
                        parts.append(types.Part(text=part["text"]))
                    elif part.get("inline_data") and part["inline_data"].get("mime_type") and part["inline_data"].get("data"):
                        # 处理图片数据
                        try:
                            image_bytes = base64.b64decode(part["inline_data"]["data"])
                            image = Image.open(io.BytesIO(image_bytes))
                            parts.append(image)
                        except Exception as e:
                            print(f"Error decoding image in history: {e}")
                            raise HTTPException(status_code=400, detail="Invalid image data in messages history")
                
                # Gemini API 的 messages 格式是 { role: 'user'/'model', parts: [...] }
                # 这里的 role 需要映射一下，'assistant' -> 'model'
                gemini_role = 'model' if role == 'assistant' else role
                contents.append(types.Content(role=gemini_role, parts=parts))
        
        # 将 prompt 添加到 contents 的末尾作为新的用户消息
        if request_data.prompt:
            contents.append(types.Content(role='user', parts=[types.Part(text=request_data.prompt)]))

        # 处理多模态输入 (如果 prompt 之后有图片，则添加到最后)
        if request_data.screenshot_data:
            try:
                image_bytes = base64.b64decode(request_data.screenshot_data)
                image = Image.open(io.BytesIO(image_bytes))
                contents.append(image)
            except Exception as e:
                print(f"Error decoding image: {e}")
                raise HTTPException(status_code=400, detail="Invalid screenshot_data format")


        # 构建 GenerateContentConfig
        config_params = {}
        if request_data.system_instruction:
            config_params["system_instruction"] = request_data.system_instruction
        if request_data.temperature is not None:
            config_params["temperature"] = request_data.temperature
        if request_data.thinking_budget is not None:
            config_params["thinking_config"] = types.ThinkingConfig(thinking_budget=request_data.thinking_budget)

        generate_config = types.GenerateContentConfig(**config_params) if config_params else None

        # 调用 Gemini API 并流式传输响应
        def generate():
            try:
                responses = gemini_client.models.generate_content_stream(
                    model=model_name,
                    contents=contents,
                    config=generate_config # 使用 generation_config
                )

                for chunk in responses:
                    if chunk.text:
                        print(f"{chunk.text}____")
                        yield f"data: {json.dumps({'text': chunk.text})}\n\n"

            except Exception as e:
                print(f"Error during Gemini API call: {e}")
                yield f"data: {json.dumps({'error': str(e)})}\n\n"

        return StreamingResponse(generate(), media_type="text/event-stream")

    except Exception as e:
        print(f"Error in /generate_content endpoint: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# 新增：LLM 配置更新端点
@app.post("/update_llm_config")
async def update_llm_config(config_update: LLMConfigUpdate):
    global current_llm_config, gemini_client
    
    if config_update.api_key:
        current_llm_config["api_key"] = config_update.api_key
        # 重新初始化 Gemini 客户端
        try:
            gemini_client = genai.Client(api_key=current_llm_config["api_key"])
            print("Gemini client re-initialized with new API key.")
        except Exception as e:
            print(f"Failed to re-initialize Gemini client with new API key: {e}")
            gemini_client = None # 确保客户端在失败时为 None
            raise HTTPException(status_code=500, detail=f"Failed to re-initialize Gemini client: {e}")

    if config_update.model:
        current_llm_config["model"] = config_update.model
        print(f"Default LLM model updated to: {current_llm_config['model']}")

    if config_update.system_prompt:
        current_llm_config["system_prompt"] = config_update.system_prompt
        print(f"Default system prompt updated to: {current_llm_config['system_prompt']}")

    return {"status": "success", "message": "LLM configuration updated."}


# 新增：翻译端点 (使用Gemini)
@app.post("/translate")
async def translate_text(request: TranslateRequest):
    if gemini_client is None:
        raise HTTPException(status_code=503, detail="Gemini API key not set, Gemini API is not available.")

    try:
        # 使用一个独立的 Gemini 调用进行翻译，不使用对话历史
        # 注意：这里的模型可以硬编码为适合翻译的模型，或者从配置中读取
        translation_model = "gemini-2.5-flash-lite-preview-06-17" # 或者其他轻量级模型
        
        # 构造翻译请求的内容
        # 格式：系统提示 + 用户提供的文本
        contents_for_translation = [
            types.Content(role='user', parts=[types.Part(text=request.text)])
        ]
        
        # 构造翻译请求的配置
        config_for_translation = types.GenerateContentConfig(
            system_instruction=request.prompt,
            temperature=0.1 # 翻译任务通常需要较低的温度以确保准确性
        )

        # 调用 Gemini API (非流式)
        response = gemini_client.models.generate_content(
            model=translation_model,
            contents=contents_for_translation,
            config=config_for_translation
        )

        translated_text = response.text
        return {"translatedText": translated_text}

    except Exception as e:
        print(f"Error during translation API call: {e}")
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")


# 健康检查
@app.get("/health")
async def health():
    return {"status": "ok"}


# 模型列表
@app.get("/v1/models")
async def list_models():
    # 从检测到的模型文件夹提取模型名称
    local_model_name = os.path.basename(model_dir) if model_dir else "local-model-not-loaded"
    
    models_data = [
        {
            "id": local_model_name,
            "object": "model",
            "created": int(time.time()),
            "owned_by": "user"
        }
    ]
    
    if gemini_client:
        models_data.append({
            "id": "gemini-2.5-flash", # 或者从配置中读取支持的Gemini模型
            "object": "model",
            "created": int(time.time()),
            "owned_by": "google"
        })
        models_data.append({
            "id": "gemini-1.5-pro", # 或者从配置中读取支持的Gemini模型
            "object": "model",
            "created": int(time.time()),
            "owned_by": "google"
        })

    return {
        "object": "list",
        "data": models_data
    }


if __name__ == "__main__":
    print("启动服务器...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
