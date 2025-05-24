#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from PyQt5.QtWidgets import (QHBoxLayout, QLabel, QLineEdit, 
                            QTextEdit, QVBoxLayout, QScrollArea)
from tabs.base_tab import BaseTab


class LLMTab(BaseTab):
    """LLM设置标签页"""
    
    def __init__(self):
        super().__init__(title="LLM")
    
    def init_ui(self):
        # API Key
        api_key_layout = QHBoxLayout()
        api_key_layout.addWidget(QLabel("API Key:"))
        self.api_key = QLineEdit()
        api_key_layout.addWidget(self.api_key)
        self.form_layout.addLayout(api_key_layout)
        
        # API URL
        api_url_layout = QHBoxLayout()
        api_url_layout.addWidget(QLabel("API URL:"))
        self.api_url = QLineEdit()
        api_url_layout.addWidget(self.api_url)
        self.form_layout.addLayout(api_url_layout)
        
        # Model
        model_layout = QHBoxLayout()
        model_layout.addWidget(QLabel("模型名称:"))
        self.model = QLineEdit()
        model_layout.addWidget(self.model)
        self.form_layout.addLayout(model_layout)
        
        # System Prompt
        system_prompt_layout = QVBoxLayout()
        system_prompt_layout.addWidget(QLabel("系统提示词:"))
        self.system_prompt = QTextEdit()
        self.system_prompt.setMinimumHeight(400)  # 增加高度
        self.system_prompt.setAcceptRichText(False)
        system_prompt_layout.addWidget(self.system_prompt)
        self.form_layout.addLayout(system_prompt_layout)
        
        # 不使用滚动区域，让文本框直接适应大小
        # 原来有问题的代码:
        # scroll = QScrollArea()
        # scroll.setWidget(self.group_box)
        # scroll.setWidgetResizable(True)
        # self.layout.addWidget(scroll)
    
    def load_config(self, config):
        self.api_key.setText(config.get("api_key", ""))
        self.api_url.setText(config.get("api_url", ""))
        self.model.setText(config.get("model", ""))
        self.system_prompt.setPlainText(config.get("system_prompt", ""))
    
    def get_config(self):
        return {
            "api_key": self.api_key.text(),
            "api_url": self.api_url.text(),
            "model": self.model.text(),
            "system_prompt": self.system_prompt.toPlainText()
        }


class TTSTab(BaseTab):
    """TTS设置标签页"""
    
    def __init__(self):
        super().__init__(title="TTS")
    
    def init_ui(self):
        # URL
        url_layout = QHBoxLayout()
        url_layout.addWidget(QLabel("URL:"))
        self.url = QLineEdit()
        url_layout.addWidget(self.url)
        self.form_layout.addLayout(url_layout)
        
        # Language
        language_layout = QHBoxLayout()
        language_layout.addWidget(QLabel("语言:"))
        self.language = QLineEdit()
        language_layout.addWidget(self.language)
        self.form_layout.addLayout(language_layout)
    
    def load_config(self, config):
        self.url.setText(config.get("url", ""))
        self.language.setText(config.get("language", ""))
    
    def get_config(self):
        return {
            "url": self.url.text(),
            "language": self.language.text()
        }


class ASRTab(BaseTab):
    """ASR设置标签页"""
    
    def __init__(self):
        super().__init__(title="ASR")
    
    def init_ui(self):
        # VAD URL
        vad_url_layout = QHBoxLayout()
        vad_url_layout.addWidget(QLabel("VAD URL:"))
        self.vad_url = QLineEdit()
        vad_url_layout.addWidget(self.vad_url)
        self.form_layout.addLayout(vad_url_layout)
        
        # ASR URL
        asr_url_layout = QHBoxLayout()
        asr_url_layout.addWidget(QLabel("ASR URL:"))
        self.asr_url = QLineEdit()
        asr_url_layout.addWidget(self.asr_url)
        self.form_layout.addLayout(asr_url_layout)
    
    def load_config(self, config):
        self.vad_url.setText(config.get("vad_url", ""))
        self.asr_url.setText(config.get("asr_url", ""))
    
    def get_config(self):
        return {
            "vad_url": self.vad_url.text(),
            "asr_url": self.asr_url.text()
        }