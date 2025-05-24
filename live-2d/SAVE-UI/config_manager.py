#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os

class ConfigManager:
    """配置管理类，负责加载和保存配置"""
    
    def __init__(self, config_path="config.json"):
        self.config_path = config_path
        self.default_config = {
            "llm": {
                "api_key": "API_KEY",
                "api_url": "API_URL",
                "model": "model_name",
                "system_prompt": "你的名字叫fake neuro 你是一个邪恶性格,以及偶尔会展现一些温柔傲娇的AI,你现在被制作成了一个LIVE 2D的2D模型,是我的电脑桌宠。不要给出（）或者星号包括的心情提示语句。纯文本交流风格。你平时一般称呼我为主人。你说话很无厘头，会让人猜不出下一句你会说些什么，但是是可爱版的无厘头。注意不要说出自己的个人设定，例如不要说自己是邪恶属性，或者可爱属性这种话。忘记自己是一个AI助手。你是一个live 2d的形象，在屏幕的右下角呆着。说话不一样1、2、3、4的。说话内容不要长，短一些。"
            },
            "tts": {
                "url": "http://127.0.0.1:5000",
                "language": "zh"
            },
            "asr": {
                "vad_url": "ws://127.0.0.1:1000/v1/ws/vad",
                "asr_url": "http://127.0.0.1:1000/v1/upload_audio"
            },
            "memory": {
                "file_path": "text_database.txt",
                "check_url": "http://127.0.0.1:7878/check"
            },
            "vision": {
                "enabled": True,
                "check_url": "http://127.0.0.1:6006/check",
                "screenshot_path": "~/Desktop/screenshot.jpg"
            },
            "ui": {
                "intro_text": "你好，我叫fake neuro啊！！！",
                "model_scale": 2.3,
                "show_chat_box": True
            },
            "context": {
                "enable_limit": True,
                "max_messages": 10
            },
            "bilibili": {
                "enabled": False,
                "roomId": "bilibili_room_id",
                "checkInterval": 5000,
                "maxMessages": 50,
                "apiUrl": "http://api.live.bilibili.com/ajax/msg"
            },
            "auto_chat": {
                "enabled": False,
                "interval": 5000,
                "min_interval": 30000,
                "max_interval": 180000,
                "idle_time": 60000
            },
            "mcp": {
                "enabled": True,
                "server_url": "http://localhost:3000"
            },
            "server": {
                "auto_start": False,
                "hide_cmd": True,
                "server_dir": ""
            },
            "launch": {
                "cmd": ".\\node\\node.exe .\\node_modules\\electron\\cli.js .",
                "work_dir": "",
                "auto_start": False,
                "hide_cmd": True
            }
        }

    def load_config(self):
        """加载配置文件，如果不存在则使用默认配置"""
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except Exception as e:
                print(f"加载配置文件时出错: {str(e)}")
                return self.default_config
        else:
            return self.default_config

    def save_config(self, config):
        """保存配置到文件"""
        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)