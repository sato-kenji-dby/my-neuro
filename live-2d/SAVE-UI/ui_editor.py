#!/usr/bin/env python3
# -*- coding: utf-8 -*-

from PyQt5.QtWidgets import (QMainWindow, QWidget, QVBoxLayout, QHBoxLayout,
                             QLabel, QPushButton, QTabWidget, QMessageBox,
                             QApplication, QFrame, QComboBox, QSizePolicy, QTabBar)
from PyQt5.QtCore import Qt, QSize, QRect, QTimer
from PyQt5.QtGui import QFont, QIcon, QPixmap, QPalette, QBrush, QPainter

import os
# 导入配置管理器
from config_manager import ConfigManager

# 导入所有标签页
from tabs import LLMTab, TTSTab, ASRTab, MemoryTab, VisionTab, UITab, ContextTab, BilibiliTab, AutoChatTab, LaunchTab


class BackgroundFrame(QWidget):
    """带有自定义背景图片的框架"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.pixmap = None
        self.bg_mode = "stretch"  # 默认拉伸模式

    def set_background(self, image_path, mode="stretch"):
        """
        设置背景图片和显示模式

        参数:
            image_path: 图片路径
            mode: 显示模式，可以是 'stretch'(拉伸), 'center'(居中), 'tile'(平铺),
                 'fit'(自适应), 'fill'(填充)
        """
        if os.path.exists(image_path):
            self.pixmap = QPixmap(image_path)
            self.bg_mode = mode
            self.update()
            return True
        return False

    def paintEvent(self, event):
        """重写绘制事件，绘制背景图片"""
        if self.pixmap:
            painter = QPainter(self)
            painter.setRenderHint(QPainter.SmoothPixmapTransform)

            rect = self.rect()

            if self.bg_mode == "stretch":
                # 拉伸模式 - 将图片拉伸到窗口大小
                painter.drawPixmap(rect, self.pixmap)

            elif self.bg_mode == "center":
                # 居中模式 - 图片居中显示，保持原始大小
                x = (rect.width() - self.pixmap.width()) // 2
                y = (rect.height() - self.pixmap.height()) // 2
                painter.drawPixmap(x, y, self.pixmap)

            elif self.bg_mode == "tile":
                # 平铺模式 - 重复显示图片
                for y in range(0, rect.height(), self.pixmap.height()):
                    for x in range(0, rect.width(), self.pixmap.width()):
                        painter.drawPixmap(x, y, self.pixmap)

            elif self.bg_mode == "fit":
                # 自适应模式 - 保持宽高比例，完整显示图片
                scaled_pixmap = self.pixmap.scaled(
                    rect.size(),
                    Qt.KeepAspectRatio,
                    Qt.SmoothTransformation
                )
                x = (rect.width() - scaled_pixmap.width()) // 2
                y = (rect.height() - scaled_pixmap.height()) // 2
                painter.drawPixmap(x, y, scaled_pixmap)

            elif self.bg_mode == "fill":
                # 填充模式 - 保持宽高比例，填充整个窗口（可能裁剪部分图片）
                scaled_pixmap = self.pixmap.scaled(
                    rect.size(),
                    Qt.KeepAspectRatioByExpanding,
                    Qt.SmoothTransformation
                )
                x = (rect.width() - scaled_pixmap.width()) // 2
                y = (rect.height() - scaled_pixmap.height()) // 2
                # 创建源矩形，确保图片居中显示
                source_rect = QRect(
                    -min(0, x),
                    -min(0, y),
                    rect.width(),
                    rect.height()
                )
                painter.drawPixmap(max(0, x), max(0, y), scaled_pixmap, source_rect.x(), source_rect.y(),
                                   source_rect.width(), source_rect.height())


# 创建自定义TabBar类以支持自适应宽度
class AdaptiveTabBar(QTabBar):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setExpanding(True)  # 使标签扩展填充可用空间
        self.setDrawBase(True)
        self.setDocumentMode(True)
        self.setElideMode(Qt.ElideRight)  # 文本过长时在右侧显示省略号

    def tabSizeHint(self, index):
        # 获取标签的默认大小
        size = super().tabSizeHint(index)

        # 计算每个标签应该占用的宽度
        # 这里我们尝试平均分配宽度，但确保最小宽度
        count = self.count()
        if count > 0:
            available_width = self.width()
            width_per_tab = max(60, available_width / count)  # 确保最小宽度为60像素
            size.setWidth(int(width_per_tab))

        return size


class ConfigEditor(QMainWindow):
    """配置编辑器主窗口"""

    def __init__(self):
        super().__init__()
        self.config_manager = ConfigManager()

        # 背景图片路径（可以根据需要修改）
        self.bg_image_path = "background.jpg"
        self.bg_mode = "fill"  # 固定为填充模式

        self.initUI()
        self.load_config()

        # 设置窗口样式表
        self.setStyleSheet(self.get_style_sheet())

        # 设置背景图片（如果存在）
        if os.path.exists(self.bg_image_path):
            self.bg_widget.set_background(self.bg_image_path, self.bg_mode)

    def initUI(self):
        """初始化UI"""
        self.setWindowTitle('肥牛UI')

        # 获取屏幕尺寸
        desktop = QApplication.desktop()
        screen_rect = desktop.availableGeometry()
        screen_width = screen_rect.width()
        screen_height = screen_rect.height()

        # 根据屏幕尺寸按比例调整窗口大小
        window_width = int(screen_width * 0.75)
        window_height = int(screen_height * 0.8)

        # 设置窗口大小
        self.setGeometry(0, 0, window_width, window_height)

        # 确保窗口可以调整大小
        self.setMinimumSize(800, 600)  # 设置最小尺寸
        self.setWindowFlags(self.windowFlags() & ~Qt.WindowMaximizeButtonHint)  # 移除最大化按钮
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)  # 设置尺寸策略为可扩展

        # 创建主窗口部件和布局
        self.bg_widget = BackgroundFrame()
        main_layout = QVBoxLayout(self.bg_widget)

        # 边距设置
        margin = 20  # 使用固定边距
        main_layout.setContentsMargins(margin, margin, margin, margin)
        main_layout.setSpacing(15)

        # 创建标签页控件 - 使用自定义TabBar
        self.tabs = QTabWidget()
        adaptive_tab_bar = AdaptiveTabBar()
        self.tabs.setTabBar(adaptive_tab_bar)

        self.tabs.setTabPosition(QTabWidget.North)
        self.tabs.setDocumentMode(True)
        self.tabs.setTabsClosable(False)
        self.tabs.setMovable(False)
        self.tabs.setUsesScrollButtons(False)  # 禁用滚动按钮

        # 设置标签页字体
        tab_font = QFont("Microsoft YaHei", 8, QFont.Bold)  # 使用小一点的字体
        self.tabs.setFont(tab_font)

        # 创建所有标签页
        self.tab_modules = {
            "launch": LaunchTab(),
            "llm": LLMTab(),
            "tts": TTSTab(),
            "asr": ASRTab(),
            "memory": MemoryTab(),
            "vision": VisionTab(),
            "ui": UITab(),
            "context": ContextTab(),
            "bilibili": BilibiliTab(),
            "auto_chat": AutoChatTab()
        }

        # 将所有标签页添加到标签控件
        for module, tab in self.tab_modules.items():
            self.tabs.addTab(tab, tab.title)

        # 添加一个水平分隔线
        separator = QFrame()
        separator.setFrameShape(QFrame.HLine)
        separator.setFrameShadow(QFrame.Sunken)

        # 添加底部信息和控制区域
        bottom_frame = QFrame()
        bottom_frame.setObjectName("bottomFrame")
        bottom_layout = QHBoxLayout(bottom_frame)

        # 添加文件路径显示
        self.file_path_label = QLabel(f"配置文件: {self.config_manager.config_path}")
        self.file_path_label.setObjectName("filePathLabel")

        # 底部按钮
        self.save_button = QPushButton('保存配置')
        self.save_button.setObjectName("saveButton")
        self.save_button.setMinimumHeight(40)
        self.save_button.setMinimumWidth(120)
        save_button_font = QFont("Microsoft YaHei", 10, QFont.Bold)
        self.save_button.setFont(save_button_font)
        self.save_button.setCursor(Qt.PointingHandCursor)
        self.save_button.clicked.connect(self.save_config)

        # 将元素添加到底部布局
        bottom_layout.addWidget(self.file_path_label, 1)  # 1表示拉伸系数
        bottom_layout.addWidget(self.save_button, 0)  # 0表示不拉伸

        # 添加各元素到主布局
        main_layout.addWidget(self.tabs)
        main_layout.addWidget(separator)
        main_layout.addWidget(bottom_frame)

        # 设置中央部件
        self.setCentralWidget(self.bg_widget)
        self.center()

    def change_bg_mode(self, index):
        """更改背景图片显示模式"""
        mode_map = {
            0: "stretch",  # 拉伸
            1: "center",  # 居中
            2: "tile",  # 平铺
            3: "fit",  # 自适应
            4: "fill"  # 填充
        }

        self.bg_mode = mode_map.get(index, "fill")
        if os.path.exists(self.bg_image_path):
            self.bg_widget.set_background(self.bg_image_path, self.bg_mode)

    def center(self):
        """将窗口居中显示并确保完全在屏幕内"""
        qr = self.frameGeometry()
        cp = QApplication.desktop().availableGeometry().center()
        qr.moveCenter(cp)

        # 获取屏幕可用区域
        available = QApplication.desktop().availableGeometry()

        # 确保窗口顶部不会超出屏幕
        if qr.top() < available.top():
            qr.moveTop(available.top())

        # 确保窗口不会超出屏幕底部
        if qr.bottom() > available.bottom():
            qr.moveBottom(available.bottom())

        # 确保窗口不会超出屏幕左侧
        if qr.left() < available.left():
            qr.moveLeft(available.left())

        # 确保窗口不会超出屏幕右侧
        if qr.right() > available.right():
            qr.moveRight(available.right())

        self.move(qr.topLeft())

    def load_config(self):
        """加载配置到UI"""
        config = self.config_manager.load_config()

        # 将配置发送到每个标签页
        for module, tab in self.tab_modules.items():
            if module in config:
                tab.load_config(config[module])

    def save_config(self):
        """从UI获取配置并保存"""
        try:
            config = {}

            # 从每个标签页获取配置
            for module, tab in self.tab_modules.items():
                config[module] = tab.get_config()

            # 特殊处理：从LaunchTab获取MCP配置
            launch_tab = self.tab_modules.get("launch")
            if hasattr(launch_tab, "get_mcp_config"):
                config["mcp"] = launch_tab.get_mcp_config()

            # 保存配置
            self.config_manager.save_config(config)

            QMessageBox.information(self, "成功", "已成功保存配置文件")
        except Exception as e:
            QMessageBox.critical(self, "错误", f"无法保存配置文件: {str(e)}")

    def closeEvent(self, event):
        """重写关闭事件，关闭窗口时同时关闭桌宠"""
        # 获取LaunchTab实例
        launch_tab = self.tab_modules.get("launch")

        # 如果桌宠正在运行，直接关闭它
        if launch_tab and (hasattr(launch_tab, 'process_running') and launch_tab.process_running):
            try:
                # 直接关闭桌宠，不询问用户
                launch_tab.close_all()
                # 等待一小段时间确保进程关闭
                QTimer.singleShot(500, lambda: event.accept())
            except Exception as e:
                print(f"关闭桌宠时出错: {str(e)}")
                event.accept()
        else:
            event.accept()

    def get_style_sheet(self):
        """返回应用程序的样式表"""
        return """
        /* 全局字体设置 */
        * {
            font-family: "Microsoft YaHei";
            font-size: 13pt;
        }

        /* 标签页样式 */
        QTabWidget::pane {
            border: 1px solid rgba(215, 210, 200, 200);
            background-color: rgba(252, 250, 245, 230);
            border-radius: 5px;
        }

        QTabBar::tab {
            background-color: rgba(245, 243, 238, 200);
            color: #725F48;
            border: 1px solid rgba(215, 210, 200, 230);
            border-bottom: none;
            border-top-left-radius: 4px;
            border-top-right-radius: 4px;
            padding: 6px 8px;  /* 减小内边距 */
            margin-right: 1px;  /* 减小右边距 */
            font-size: 11pt;    /* 减小字体大小 */
            font-weight: bold;
        }

        QTabBar::tab:selected {
            background-color: rgba(252, 250, 245, 230);
            color: #8B7055;
            border-bottom: 2px solid #B89B82;
        }

        QTabBar::tab:hover:!selected {
            background-color: rgba(248, 246, 241, 230);
        }

        /* 分组框样式 */
        QGroupBox {
            font-weight: bold;
            border: 1px solid rgba(215, 210, 200, 230);
            border-radius: 5px;
            margin-top: 24px;    /* 增加顶部间距 */
            padding-top: 18px;   /* 增加上内边距 */
            background-color: rgba(248, 246, 241, 200);
            color: #725F48;
            font-size: 14pt;     /* 分组框标题更大 */
        }

        QGroupBox::title {
            subcontrol-origin: margin;
            subcontrol-position: top center;
            padding: 0 10px;
            color: #8B7055;
        }

        /* 文本框样式 */
        QLineEdit, QTextEdit, QPlainTextEdit {
            background-color: rgba(255, 253, 248, 230);
            color: #725F48;
            border: 1px solid rgba(215, 210, 200, 230);
            border-radius: 4px;
            padding: 10px;       /* 增加内边距 */
            selection-background-color: #E8DFD3;
            min-height: 28px;    /* 增加最小高度 */
        }

        QLineEdit:focus, QTextEdit:focus, QPlainTextEdit:focus {
            border: 1px solid #B89B82;
        }

        /* 按钮样式 */
        QPushButton {
            background-color: rgba(184, 155, 130, 230);
            color: white;
            border: none;
            border-radius: 4px;
            padding: 10px 20px;  /* 增加内边距 */
            min-height: 36px;    /* 增加最小高度 */
            font-size: 13pt;
        }

        QPushButton:hover {
            background-color: rgba(204, 175, 150, 230);
        }

        QPushButton:pressed {
            background-color: rgba(164, 135, 110, 230);
        }

        QPushButton:disabled {
            background-color: rgba(220, 215, 210, 230);
            color: #909090;
        }

        /* 复选框样式 */
        QCheckBox {
            spacing: 10px;       /* 增加间距 */
            color: #725F48;
            font-size: 13pt;
        }

        QCheckBox::indicator {
            width: 22px;         /* 增加指示器大小 */
            height: 22px;
            border: 1px solid rgba(215, 210, 200, 230);
            border-radius: 3px;
            background-color: rgba(255, 253, 248, 230);
        }

        QCheckBox::indicator:checked {
            background-color: rgba(184, 155, 130, 230);
        }

        QCheckBox::indicator:unchecked:hover {
            border: 1px solid rgba(184, 155, 130, 230);
        }

        /* 标签样式 */
        QLabel {
            color: #725F48;
            font-size: 13pt;
            min-height: 24px;    /* 增加最小高度 */
        }

        QLabel#filePathLabel {
            color: #9C8A75;
        }

        /* 下拉框样式 */
        QComboBox {
            background-color: rgba(255, 253, 248, 230);
            color: #725F48;
            border: 1px solid rgba(215, 210, 200, 230);
            border-radius: 4px;
            padding: 8px 12px;   /* 增加内边距 */
            min-width: 6em;
            min-height: 28px;    /* 增加最小高度 */
        }

        QComboBox:hover {
            border: 1px solid rgba(184, 155, 130, 230);
        }

        QComboBox::drop-down {
            subcontrol-origin: padding;
            subcontrol-position: top right;
            width: 24px;         /* 增加下拉按钮宽度 */
            border-left: 1px solid rgba(215, 210, 200, 230);
        }

        /* 数字输入框样式 */
        QSpinBox, QDoubleSpinBox {
            background-color: rgba(255, 253, 248, 230);
            color: #725F48;
            border: 1px solid rgba(215, 210, 200, 230);
            border-radius: 4px;
            padding: 8px 12px;   /* 增加内边距 */
            min-height: 28px;    /* 增加最小高度 */
        }

        QSpinBox:hover, QDoubleSpinBox:hover {
            border: 1px solid rgba(184, 155, 130, 230);
        }

        QSpinBox::up-button, QSpinBox::down-button,
        QDoubleSpinBox::up-button, QDoubleSpinBox::down-button {
            background-color: rgba(248, 246, 241, 230);
            width: 20px;         /* 增加按钮宽度 */
            border-radius: 2px;
        }

        /* 滚动条样式 */
        QScrollBar:vertical {
            border: none;
            background-color: rgba(248, 246, 241, 180);
            width: 16px;         /* 增加滚动条宽度 */
            margin: 0px;
        }

        QScrollBar::handle:vertical {
            background-color: rgba(215, 210, 200, 230);
            min-height: 30px;    /* 增加滑块最小高度 */
            border-radius: 8px;
        }

        QScrollBar::handle:vertical:hover {
            background-color: rgba(195, 190, 180, 230);
        }

        QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {
            height: 0px;
        }

        QScrollBar:horizontal {
            border: none;
            background-color: rgba(248, 246, 241, 180);
            height: 16px;        /* 增加滚动条高度 */
            margin: 0px;
        }

        QScrollBar::handle:horizontal {
            background-color: rgba(215, 210, 200, 230);
            min-width: 30px;     /* 增加滑块最小宽度 */
            border-radius: 8px;
        }

        QScrollBar::handle:horizontal:hover {
            background-color: rgba(195, 190, 180, 230);
        }

        QScrollBar::add-line:horizontal, QScrollBar::sub-line:horizontal {
            width: 0px;
        }

        /* 底部框架样式 */
        QFrame#bottomFrame {
            background-color: rgba(248, 246, 241, 230);
            border-radius: 5px;
            padding: 10px;       /* 增加内边距 */
        }

        /* 保存按钮特殊样式 */
        QPushButton#saveButton {
            background-color: rgba(184, 155, 130, 230);
            font-weight: bold;
            font-size: 14pt;     /* 保存按钮字体更大 */
            min-height: 45px;    /* 保持原有高度 */
            min-width: 150px;    /* 保持原有宽度 */
        }
        """