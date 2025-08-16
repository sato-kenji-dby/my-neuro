# My-Neuro: 个人 AI 伙伴工作台

## 项目简介

本项目的目标是打造一个专属的、可定制的个人 AI 伙伴。项目灵感来源于 Neuro-sama，旨在提供一个工作台，让用户可以通过训练声音、塑造性格、替换形象，一步步创造出心目中理想的 AI 形象。

**本项目是 [morettt/my-neuro](https://github.com/morettt/my-neuro) 的一个 fork 版本，主要进行了以下工作：**

*   **前端重构**: 使用 SvelteKit + TypeScript + Tailwind CSS 对 `live-2d` 前端应用进行了完全重构，提升了代码质量、可维护性和开发体验。
*   **架构优化**: 对 Electron 的主进程和渲染进程进行了清晰的分离，引入了事件驱动和集中式状态管理，并解决了大量启动流程和进程管理方面的问题。
*   **功能迭代**: 在原项目基础上进行功能优化和新功能探索，如专注模式、高级字幕系统等。

## 核心功能

*   **双模型支持**: 支持本地部署的开源模型和接入第三方闭源模型 API。
*   **低延迟交互**: 核心模块本地化部署，保证低延迟的对话体验。
*   **高度可定制**:
    *   **语音**: 支持通过 GPT-SoVITS，MoeGoe 等项目训练和定制声音。
    *   **形象**: 支持替换 Live2D 模型。
    *   **性格**: 支持通过调整提示词或微调模型来塑造 AI 性格。
*   **本地视觉能力**: 通过本地部署的VLM（视觉语言模型）实现全屏内容理解，截图数据无需上传至云端，保护用户隐私。
*   **专注模式**: 可设定当前任务，AI 伙伴将通过视觉能力判断用户是否分心并给予提醒。
*   **高级桌面看板**:
    *   窗口背景透明，可与下方应用交互（鼠标穿透）。
    *   模型和UI控件区域可动态识别并响应交互（如拖动、点击）。
*   **高级字幕系统**: 支持逐句、逐字的“打字机”涌现效果，并集成了翻译功能。
*   **直播集成**: 支持B站直播弹幕互动。
*   **主动对话与长期记忆**: 具备初步的上下文理解、主动发起对话和记忆关键信息的能力。
*   **MCP 支持**: 可通过 MCP (Model Context Protocol) 协议扩展更多工具和功能。

## 快速开始

### 环境准备

1.  **硬件**:
    *   基础运行: 建议至少 6GB 显存的 NVIDIA 显卡。
    *   本地 LLM/VLM 推理/微调: 建议至少 12GB 显存。
2.  **软件**:
    *   安装 [Anaconda](https://www.anaconda.com/download/success)。
    *   准备一个可用的 LLM/VLM API Key (如 OpenAI, DeepSeek, 智谱等)。

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

4.  **配置应用**:
    *   进入 `live-2d` 目录，复制 `config_original.json` 并重命名为 `config.json`。
    *   打开 `config.json`，填入你自己的 API Key 等信息。

5.  **一键启动**:
    进入 `live-2d` 目录，安装前端依赖并启动应用。所有后端服务将由 Electron 自动管理。
    ```bash
    cd live-2d
    npm install
    npm run dev
    ```
    应用启动后即可开始使用。

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
