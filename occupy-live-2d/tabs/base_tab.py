#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from PyQt5.QtWidgets import QWidget, QVBoxLayout, QGroupBox, QScrollArea, QSizePolicy
from PyQt5.QtCore import Qt
from PyQt5.QtGui import QFont


class BaseTab(QWidget):
    """所有标签页的基类，提供统一的样式和布局"""

    def __init__(self, title="标签"):
        super().__init__()
        self.title = title

        # 创建基本布局
        self.layout = QVBoxLayout(self)
        self.layout.setContentsMargins(15, 15, 15, 15)  # 增加边距
        self.layout.setSpacing(10)  # 增加控件间距

        # 创建分组框 - 恢复原始字体大小
        self.group_box = QGroupBox(f"{title}设置")
        self.group_box.setFont(QFont("Microsoft YaHei", 11, QFont.Bold))

        # 创建表单布局
        self.form_layout = QVBoxLayout()
        self.form_layout.setContentsMargins(15, 20, 15, 15)  # 增加内边距
        self.form_layout.setSpacing(15)  # 增加控件间距

        # 添加滚动区域
        self.scroll_area = QScrollArea()
        self.scroll_area.setWidgetResizable(True)
        self.scroll_area.setFrameShape(QScrollArea.NoFrame)  # 无边框
        self.scroll_area.setHorizontalScrollBarPolicy(Qt.ScrollBarAlwaysOff)  # 禁用水平滚动条

        # 注释掉这一行，避免init_ui被调用两次
        # self.init_ui()

        # 子类需要在init_ui中添加具体控件
        self.init_ui()

        # 完成布局设置
        self.group_box.setLayout(self.form_layout)
        self.scroll_area.setWidget(self.group_box)
        self.layout.addWidget(self.scroll_area)

        # 设置尺寸策略
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)

    def init_ui(self):
        """初始化UI，子类需要重写此方法"""
        pass

    def load_config(self, config):
        """加载配置到UI，子类需要重写此方法"""
        pass

    def get_config(self):
        """从UI获取配置，子类需要重写此方法"""
        return {}