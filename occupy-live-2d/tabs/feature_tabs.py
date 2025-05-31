#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import subprocess
import time
import threading
from PyQt5.QtWidgets import (QHBoxLayout, QVBoxLayout, QLabel, QLineEdit, QCheckBox,
                             QPushButton, QFileDialog, QDoubleSpinBox,
                             QSpinBox, QTextEdit, QGroupBox, QMessageBox,
                             QFrame)
from PyQt5.QtCore import Qt, QTimer, pyqtSignal, QObject
from PyQt5.QtGui import QColor, QFont
from tabs.base_tab import BaseTab


class MemoryTab(BaseTab):
    """记忆设置标签页"""

    def __init__(self):
        super().__init__(title="记忆")

    def init_ui(self):
        # File Path
        file_path_layout = QHBoxLayout()
        file_path_layout.addWidget(QLabel("文件路径:"))
        self.file_path = QLineEdit()
        file_path_layout.addWidget(self.file_path)
        browse_button = QPushButton("浏览...")
        browse_button.clicked.connect(self.browse_file)
        file_path_layout.addWidget(browse_button)
        self.form_layout.addLayout(file_path_layout)

        # Check URL
        check_url_layout = QHBoxLayout()
        check_url_layout.addWidget(QLabel("检查 URL:"))
        self.check_url = QLineEdit()
        check_url_layout.addWidget(self.check_url)
        self.form_layout.addLayout(check_url_layout)

    def browse_file(self):
        file_path, _ = QFileDialog.getOpenFileName(self, "选择记忆文件", "", "文本文件 (*.txt);;所有文件 (*)")
        if file_path:
            self.file_path.setText(file_path)

    def load_config(self, config):
        self.file_path.setText(config.get("file_path", ""))
        self.check_url.setText(config.get("check_url", ""))

    def get_config(self):
        return {
            "file_path": self.file_path.text(),
            "check_url": self.check_url.text()
        }


class VisionTab(BaseTab):
    """视觉设置标签页"""

    def __init__(self):
        super().__init__(title="视觉")

    def init_ui(self):
        # Enabled
        enabled_layout = QHBoxLayout()
        self.enabled = QCheckBox("启用视觉功能")
        enabled_layout.addWidget(self.enabled)
        self.form_layout.addLayout(enabled_layout)

        # Check URL
        check_url_layout = QHBoxLayout()
        check_url_layout.addWidget(QLabel("检查 URL:"))
        self.check_url = QLineEdit()
        check_url_layout.addWidget(self.check_url)
        self.form_layout.addLayout(check_url_layout)

        # Screenshot Path
        screenshot_path_layout = QHBoxLayout()
        screenshot_path_layout.addWidget(QLabel("截图路径:"))
        self.screenshot_path = QLineEdit()
        screenshot_path_layout.addWidget(self.screenshot_path)
        browse_button = QPushButton("浏览...")
        browse_button.clicked.connect(self.browse_path)
        screenshot_path_layout.addWidget(browse_button)
        self.form_layout.addLayout(screenshot_path_layout)

    def browse_path(self):
        file_path, _ = QFileDialog.getOpenFileName(self, "选择截图路径", "", "图像文件 (*.jpg *.png);;所有文件 (*)")
        if file_path:
            self.screenshot_path.setText(file_path)

    def load_config(self, config):
        self.enabled.setChecked(config.get("enabled", False))
        self.check_url.setText(config.get("check_url", ""))
        self.screenshot_path.setText(config.get("screenshot_path", ""))

    def get_config(self):
        return {
            "enabled": self.enabled.isChecked(),
            "check_url": self.check_url.text(),
            "screenshot_path": self.screenshot_path.text()
        }


class UITab(BaseTab):
    """UI设置标签页"""

    def __init__(self):
        super().__init__(title="开场白")

    def init_ui(self):
        # Intro Text
        intro_text_layout = QHBoxLayout()
        intro_text_layout.addWidget(QLabel("介绍文本:"))
        self.intro_text = QLineEdit()
        intro_text_layout.addWidget(self.intro_text)
        self.form_layout.addLayout(intro_text_layout)

        # Model Scale
        model_scale_layout = QHBoxLayout()
        model_scale_layout.addWidget(QLabel("模型缩放:"))
        self.model_scale = QDoubleSpinBox()
        self.model_scale.setRange(0.1, 10.0)
        self.model_scale.setSingleStep(0.1)
        model_scale_layout.addWidget(self.model_scale)
        self.form_layout.addLayout(model_scale_layout)

        # Show Chat Box
        self.show_chat_box = QCheckBox("显示对话框")
        self.form_layout.addWidget(self.show_chat_box)

    def load_config(self, config):
        self.intro_text.setText(config.get("intro_text", ""))
        self.model_scale.setValue(config.get("model_scale", 1.0))
        self.show_chat_box.setChecked(config.get("show_chat_box", True))

    def get_config(self):
        return {
            "intro_text": self.intro_text.text(),
            "model_scale": self.model_scale.value(),
            "show_chat_box": self.show_chat_box.isChecked()
        }


class ContextTab(BaseTab):
    """上下文设置标签页"""

    def __init__(self):
        super().__init__(title="上下文")

    def init_ui(self):
        # Enable Limit
        enable_limit_layout = QHBoxLayout()
        self.enable_limit = QCheckBox("启用限制")
        enable_limit_layout.addWidget(self.enable_limit)
        self.form_layout.addLayout(enable_limit_layout)

        # Max Messages
        max_messages_layout = QHBoxLayout()
        max_messages_layout.addWidget(QLabel("最大消息数:"))
        self.max_messages = QSpinBox()
        self.max_messages.setRange(1, 1000)
        max_messages_layout.addWidget(self.max_messages)
        self.form_layout.addLayout(max_messages_layout)

    def load_config(self, config):
        self.enable_limit.setChecked(config.get("enable_limit", False))
        self.max_messages.setValue(config.get("max_messages", 10))

    def get_config(self):
        return {
            "enable_limit": self.enable_limit.isChecked(),
            "max_messages": self.max_messages.value()
        }


class ServerSignals(QObject):
    """服务器输出信号类，用于从子线程向主线程发送信号"""
    output = pyqtSignal(str)
    error = pyqtSignal(str)
    finished = pyqtSignal()