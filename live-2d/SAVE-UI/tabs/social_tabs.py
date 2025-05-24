#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from PyQt5.QtWidgets import (QHBoxLayout, QLabel, QLineEdit, QCheckBox,
                            QSpinBox)
from tabs.base_tab import BaseTab


class BilibiliTab(BaseTab):
    """哔哩哔哩设置标签页"""
    
    def __init__(self):
        super().__init__(title="哔哩哔哩")
    
    def init_ui(self):
        # Enabled
        enabled_layout = QHBoxLayout()
        self.enabled = QCheckBox("启动哔哩哔哩直播功能")
        enabled_layout.addWidget(self.enabled)
        self.form_layout.addLayout(enabled_layout)
        
        # Room ID
        room_id_layout = QHBoxLayout()
        room_id_layout.addWidget(QLabel("房间 ID:"))
        self.room_id = QLineEdit()
        room_id_layout.addWidget(self.room_id)
        self.form_layout.addLayout(room_id_layout)
        
        # Check Interval
        check_interval_layout = QHBoxLayout()
        check_interval_layout.addWidget(QLabel("检查间隔 (毫秒):"))
        self.check_interval = QSpinBox()
        self.check_interval.setRange(100, 60000)
        self.check_interval.setSingleStep(100)
        check_interval_layout.addWidget(self.check_interval)
        self.form_layout.addLayout(check_interval_layout)
        
        # Max Messages
        max_messages_layout = QHBoxLayout()
        max_messages_layout.addWidget(QLabel("最大消息数:"))
        self.max_messages = QSpinBox()
        self.max_messages.setRange(1, 1000)
        max_messages_layout.addWidget(self.max_messages)
        self.form_layout.addLayout(max_messages_layout)
        
        # API URL
        api_url_layout = QHBoxLayout()
        api_url_layout.addWidget(QLabel("API URL:"))
        self.api_url = QLineEdit()
        api_url_layout.addWidget(self.api_url)
        self.form_layout.addLayout(api_url_layout)
    
    def load_config(self, config):
        self.enabled.setChecked(config.get("enabled", False))
        self.room_id.setText(config.get("roomId", ""))
        self.check_interval.setValue(config.get("checkInterval", 5000))
        self.max_messages.setValue(config.get("maxMessages", 50))
        self.api_url.setText(config.get("apiUrl", ""))
    
    def get_config(self):
        return {
            "enabled": self.enabled.isChecked(),
            "roomId": self.room_id.text(),
            "checkInterval": self.check_interval.value(),
            "maxMessages": self.max_messages.value(),
            "apiUrl": self.api_url.text()
        }


class AutoChatTab(BaseTab):
    """主动对话设置标签页"""
    
    def __init__(self):
        super().__init__(title="主动对话")
    
    def init_ui(self):
        # Enabled
        enabled_layout = QHBoxLayout()
        self.enabled = QCheckBox("启用主动对话")
        enabled_layout.addWidget(self.enabled)
        self.form_layout.addLayout(enabled_layout)
        
        # Interval
        interval_layout = QHBoxLayout()
        interval_layout.addWidget(QLabel("间隔 (毫秒):"))
        self.interval = QSpinBox()
        self.interval.setRange(100, 600000)
        self.interval.setSingleStep(100)
        interval_layout.addWidget(self.interval)
        self.form_layout.addLayout(interval_layout)
        
        # Min Interval
        min_interval_layout = QHBoxLayout()
        min_interval_layout.addWidget(QLabel("最小间隔 (毫秒):"))
        self.min_interval = QSpinBox()
        self.min_interval.setRange(100, 600000)
        self.min_interval.setSingleStep(100)
        min_interval_layout.addWidget(self.min_interval)
        self.form_layout.addLayout(min_interval_layout)
        
        # Max Interval
        max_interval_layout = QHBoxLayout()
        max_interval_layout.addWidget(QLabel("最大间隔 (毫秒):"))
        self.max_interval = QSpinBox()
        self.max_interval.setRange(100, 600000)
        self.max_interval.setSingleStep(100)
        max_interval_layout.addWidget(self.max_interval)
        self.form_layout.addLayout(max_interval_layout)
        
        # Idle Time
        idle_time_layout = QHBoxLayout()
        idle_time_layout.addWidget(QLabel("空闲时间 (毫秒):"))
        self.idle_time = QSpinBox()
        self.idle_time.setRange(100, 600000)
        self.idle_time.setSingleStep(100)
        idle_time_layout.addWidget(self.idle_time)
        self.form_layout.addLayout(idle_time_layout)
    
    def load_config(self, config):
        self.enabled.setChecked(config.get("enabled", False))
        self.interval.setValue(config.get("interval", 5000))
        self.min_interval.setValue(config.get("min_interval", 30000))
        self.max_interval.setValue(config.get("max_interval", 180000))
        self.idle_time.setValue(config.get("idle_time", 60000))
    
    def get_config(self):
        return {
            "enabled": self.enabled.isChecked(),
            "interval": self.interval.value(),
            "min_interval": self.min_interval.value(),
            "max_interval": self.max_interval.value(),
            "idle_time": self.idle_time.value()
        }