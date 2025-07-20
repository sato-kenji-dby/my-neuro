# My-Neuro: 个人 AI 伙伴工作台

## 项目简介

本项目的目标是打造一个专属的、可定制的个人 AI 伙伴。项目灵感来源于 Neuro-sama，旨在提供一个工作台，让用户可以通过训练声音、塑造性格、替换形象，一步步创造出心目中理想的 AI 形象。

**本项目是 [morettt/my-neuro](https://github.com/morettt/my-neuro) 的一个 fork 版本，主要进行了以下工作：**

*   **前端重构**: 使用 SvelteKit + TypeScript + Tailwind CSS 对 `live-2d` 前端应用进行了完全重构，提升了代码质量、可维护性和开发体验。
*   **功能迭代**: 在原项目基础上进行功能优化和新功能探索。

## 核心功能

*   **双模型支持**: 支持本地部署的开源模型和接入第三方闭源模型 API。
*   **低延迟交互**: 核心模块本地化部署，保证低延迟的对话体验。
*   **高度可定制**:
    *   **语音**: 支持通过 GPT-SoVITS，MoeGoe 等项目训练和定制声音。
    *   **形象**: 支持替换 Live2D 模型。
    *   **性格**: 支持通过调整提示词或微调模型来塑造 AI 性格。
*   **视觉能力**: 集成视觉模型，可根据对话意图识别图像。
*   **直播集成**: 支持B站直播弹幕互动。
*   **主动对话与长期记忆**: 具备初步的上下文理解、主动发起对话和记忆关键信息的能力。
*   **MCP 支持**: 可通过 MCP (Model Context Protocol) 协议扩展更多工具和功能。

## 快速开始

### 环境准备

1.  **硬件**:
    *   基础运行: 建议至少 6GB 显存的 NVIDIA 显卡。
    *   本地 LLM 推理/微调: 建议至少 12GB 显存。
2.  **软件**:
    *   安装 [Anaconda](https://www.anaconda.com/download/success)。
    *   准备一个可用的 LLM API Key (如 OpenAI, DeepSeek, 智谱等)。

### 启动步骤

1.  **创建 Conda 环境**:
    ```bash
    conda create -n my-neuro python=3.11 -y
    conda activate my-neuro
    ```

2.  **安装依赖**:
    ```bash
    # 安装核心依赖
    pip install -r requirements.txt
    # 安装 PyTorch (请根据你的 CUDA 版本从官网选择合适的命令)
    pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
    # 安装 ffmpeg
    conda install ffmpeg -y
    ```

3.  **下载模型**:
    运行脚本自动下载所需的各种模型。
    ```bash
    python Batch_Download.py
    ```

4.  **启动后端服务**:
    依次启动 ASR, TTS, BERT 等本地服务。
    ```bash
    # 启动 ASR 服务
    python asr_api.py
    # 启动 BERT 服务
    python bert_api.py
    # 启动记忆 BERT 服务
    python Mnemosyne-bert\api_go.py
    # 启动 TTS 服务
    cd tts-studio
    python tts_api.py 
    ```

5.  **启动前端应用**:
    进入 `live-2d` 目录，安装依赖并启动。
    ```bash
    cd live-2d
    npm install
    npm run dev
    ```
    应用启动后，根据界面提示配置 API Key 等信息即可开始使用。

## 未来计划

本项目将持续迭代，未来的开发重点包括：

*   **增强情感与个性**: 深入模拟情绪状态，实现更真实的人机交互。
*   **扩展交互场景**: 探索游戏陪玩、共同观看视频、日程管理等功能。
*   **桌面控制**: 支持通过语音控制操作系统。
*   **Web UI**: 提供一个功能完善的 Web 管理界面。

## 致谢

*   感谢原项目 [morettt/my-neuro](https://github.com/morettt/my-neuro) 的作者。
*   感谢 [GPT-SoVITS](https://github.com/RVC-Boss/GPT-SoVITS) 等优秀的开源项目。
*   感谢所有社区贡献者和赞助者。
