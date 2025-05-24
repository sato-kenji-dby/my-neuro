#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import sys
import os
from PyQt5.QtWidgets import QApplication
from PyQt5.QtGui import QIcon, QFontDatabase
from PyQt5.QtCore import Qt  # 添加这一行导入Qt模块
from ui_editor import ConfigEditor


def main():
    # 启用高DPI缩放
    QApplication.setAttribute(Qt.AA_EnableHighDpiScaling, True)
    QApplication.setAttribute(Qt.AA_UseHighDpiPixmaps, True)

    app = QApplication(sys.argv)

    # 增加字体数据库
    font_dir = "fonts"
    # 创建字体目录（如果不存在）
    os.makedirs(font_dir, exist_ok=True)

    # 设置应用图标（如果图标不存在，则跳过）
    icon_path = "icon.ico"
    if os.path.exists(icon_path):
        app.setWindowIcon(QIcon(icon_path))

    # 创建主窗口
    editor = ConfigEditor()
    editor.show()

    # 启动应用
    sys.exit(app.exec_())


if __name__ == "__main__":
    main()