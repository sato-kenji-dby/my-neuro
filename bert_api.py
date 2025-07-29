from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel # 导入 BaseModel
from transformers import AutoTokenizer, AutoModelForSequenceClassification
import torch

app = FastAPI()

# 定义请求体模型
class DistractionCheckRequest(BaseModel):
    task_description: str
    screen_description: str

# 添加CORS中间件配置
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 允许所有来源，生产环境中应该设置为特定域名
    allow_credentials=True,
    allow_methods=["*"],  # 允许所有方法
    allow_headers=["*"],  # 允许所有头
)

# 检测是否有可用的GPU
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}")

# 加载模型和tokenizer
model_path = r'bert-model'
tokenizer = AutoTokenizer.from_pretrained(model_path)
model = AutoModelForSequenceClassification.from_pretrained(model_path)

# 将模型移动到GPU
model = model.to(device)
model.eval()

@app.post("/check")
async def check_text(text: str):
    # 预测
    inputs = tokenizer(text, return_tensors="pt", padding=True, truncation=True)
    
    # 将输入也移动到相同的设备
    inputs = {k: v.to(device) for k, v in inputs.items()}
    
    with torch.no_grad():
        outputs = model(**inputs)
        prediction = outputs.logits.argmax(-1).item()
    
    # 返回结果
    return {"text": text, "需要视觉": "是" if prediction == 1 else "否"}

@app.post("/check_distraction")
async def check_distraction(request: DistractionCheckRequest):
    # 将任务描述和屏幕描述拼接起来进行BERT分析
    # 这里的拼接方式可能需要根据BERT模型的训练方式进行调整
    # 例如，可以使用 [CLS] task_description [SEP] screen_description [SEP]
    # 但为了通用性，我们先简单拼接
    combined_text = f"{request.task_description} {request.screen_description}"

    inputs = tokenizer(combined_text, return_tensors="pt", padding=True, truncation=True)
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        outputs = model(**inputs)
        prediction = outputs.logits.argmax(-1).item()
    
    # 假设 prediction == 0 表示分心（与 /check 端点的逻辑保持一致）
    is_distracted = True if prediction == 0 else False
    
    return {"is_distracted": is_distracted}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=6006)
