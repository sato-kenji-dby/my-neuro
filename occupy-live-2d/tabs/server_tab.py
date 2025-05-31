#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os
import subprocess
import time
import threading
from PyQt5.QtWidgets import (QHBoxLayout, QVBoxLayout, QLabel,
                           QPushButton, QCheckBox, QMessageBox,
                           QTextEdit, QGroupBox)
from PyQt5.QtCore import Qt, QTimer, pyqtSignal, QObject
from PyQt5.QtGui import QColor
from tabs.base_tab import BaseTab


class ServerSignals(QObject):
    """服务器输出信号类，用于从子线程向主线程发送信号"""
    output = pyqtSignal(str)
    error = pyqtSignal(str)
    finished = pyqtSignal()


class ServerTab(BaseTab):
    """服务器启动标签页"""
    
    def __init__(self):
        super().__init__(title="服务器")
        self.process = None
        self.process_running = False
        self.last_launch_time = 0
        self.signals = ServerSignals()
        self.signals.output.connect(self.update_output)
        self.signals.error.connect(self.update_error)
        self.signals.finished.connect(self.process_finished)
        # 设置服务器默认路径
        self.server_dir = os.path.join(os.getcwd(), "server-tools")
        
    def init_ui(self):
        # 自动启动选项
        self.auto_start = QCheckBox("启动程序时自动启动服务器")
        self.form_layout.addWidget(self.auto_start)
        
        # 隐藏CMD窗口选项
        self.hide_cmd = QCheckBox("隐藏CMD窗口")
        self.hide_cmd.setChecked(True)  # 默认选中
        self.form_layout.addWidget(self.hide_cmd)
        
        # 启动和关闭按钮
        buttons_layout = QHBoxLayout()
        
        # 启动按钮
        self.launch_button = QPushButton("启动服务器")
        self.launch_button.setMinimumHeight(50)  # 设置按钮高度
        self.launch_button.setStyleSheet("""
            QPushButton {
                background-color: rgba(0, 150, 0, 230);
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: rgba(0, 180, 0, 230);
            }
            QPushButton:pressed {
                background-color: rgba(0, 120, 0, 230);
            }
        """)
        self.launch_button.clicked.connect(self.launch_server)
        
        # 关闭按钮
        self.close_button = QPushButton("关闭服务器")
        self.close_button.setMinimumHeight(50)  # 设置按钮高度
        self.close_button.setStyleSheet("""
            QPushButton {
                background-color: rgba(150, 0, 0, 230);
                font-size: 14px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: rgba(180, 0, 0, 230);
            }
            QPushButton:pressed {
                background-color: rgba(120, 0, 0, 230);
            }
            QPushButton:disabled {
                background-color: rgba(100, 60, 60, 230);
            }
        """)
        self.close_button.clicked.connect(self.close_server)
        self.close_button.setEnabled(False)  # 初始禁用
        
        buttons_layout.addWidget(self.launch_button)
        buttons_layout.addWidget(self.close_button)
        self.form_layout.addLayout(buttons_layout)
        
        # 状态显示
        status_layout = QHBoxLayout()
        status_layout.addWidget(QLabel("状态:"))
        self.status_label = QLabel("未启动")
        self.status_label.setStyleSheet("color: #FF5555;")
        status_layout.addWidget(self.status_label)
        status_layout.addStretch()
        self.form_layout.addLayout(status_layout)
        
        # 输出显示框
        output_group = QGroupBox("输出日志")
        output_layout = QVBoxLayout(output_group)
        
        self.output_text = QTextEdit()
        self.output_text.setReadOnly(True)
        self.output_text.setStyleSheet("""
            background-color: rgba(30, 30, 30, 230);
            color: #CCCCCC;
            border: 1px solid rgba(63, 63, 70, 230);
        """)
        self.output_text.setMinimumHeight(200)
        output_layout.addWidget(self.output_text)
        
        # 清空按钮
        clear_button = QPushButton("清空日志")
        clear_button.clicked.connect(self.clear_output)
        output_layout.addWidget(clear_button)
        
        self.form_layout.addWidget(output_group)
        
        # 启动定时器用于检查进程状态
        self.check_timer = QTimer()
        self.check_timer.timeout.connect(self.check_process_status)
        self.check_timer.start(2000)  # 每2秒检查一次
    
    def launch_server(self):
        """启动服务器，包含防止多次启动的机制"""
        # 检查是否已经在运行
        if self.process_running:
            QMessageBox.information(self, "提示", "服务器已经在运行中")
            return
        
        # 检查两次启动之间的时间间隔，防止短时间内多次点击
        current_time = time.time()
        if current_time - self.last_launch_time < 3:  # 设置3秒的冷却时间
            QMessageBox.information(self, "提示", "请稍后再试")
            return
        
        self.last_launch_time = current_time
        
        try:
            # 检查服务器目录是否存在
            if not os.path.exists(self.server_dir):
                QMessageBox.critical(self, "错误", f"服务器目录不存在: {self.server_dir}")
                return
                
            # 创建启动脚本
            bat_path = os.path.join(self.server_dir, "start_server.bat")
            with open(bat_path, "w", encoding="utf-8") as f:
                f.write("@echo off\n")
                f.write("chcp 65001\n")
                f.write(f"cd /d {self.server_dir}\n")
                f.write("echo 正在启动服务器...\n")
                f.write("node server.js\n")
                f.write("if %ERRORLEVEL% NEQ 0 pause\n")  # 出错时暂停
                f.write("exit\n")
            
            self.log_message("正在启动服务器...", "normal")
            
            # 决定是否隐藏CMD窗口
            if self.hide_cmd.isChecked():
                # 使用subprocess.PIPE捕获输出
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 0  # SW_HIDE
                
                self.process = subprocess.Popen(
                    bat_path,
                    cwd=self.server_dir,
                    shell=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    startupinfo=startupinfo,
                    universal_newlines=True,  # 文本模式
                    bufsize=1,  # 行缓冲
                    encoding='utf-8',  # 确保正确编码
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP  # 创建新的进程组，便于发送信号
                )
                
                # 启动线程来读取输出
                threading.Thread(target=self.read_output, daemon=True).start()
                threading.Thread(target=self.read_error, daemon=True).start()
            else:
                # 直接显示CMD窗口
                self.process = subprocess.Popen(
                    bat_path,
                    cwd=self.server_dir,
                    shell=True,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP  # 创建新的进程组，便于发送信号
                )
            
            self.process_running = True
            self.status_label.setText("已启动")
            self.status_label.setStyleSheet("color: #55FF55;")
            
            # 更新按钮状态
            self.launch_button.setEnabled(False)
            self.close_button.setEnabled(True)
            
            # 延迟一段时间后重新启用启动按钮，但保持关闭按钮启用
            QTimer.singleShot(5000, lambda: self.launch_button.setEnabled(True))
            
        except Exception as e:
            self.log_message(f"启动失败: {str(e)}", "error")
            QMessageBox.critical(self, "错误", f"启动服务器失败: {str(e)}")

    def close_server(self):
        """关闭服务器"""
        if not self.process_running or not self.process:
            QMessageBox.information(self, "提示", "没有正在运行的服务器")
            return

        try:
            self.log_message("正在关闭服务器...", "normal")

            # 在Windows上，使用taskkill来终止进程
            # 找到node.exe进程并终止
            # 注意：这会关闭所有node.exe进程，如果有其他node应用在运行，可能需要更精确的方法
            subprocess.call(['taskkill', '/F', '/IM', 'node.exe'], shell=True)

            # 更新UI状态
            self.process_running = False
            self.status_label.setText("已关闭")
            self.status_label.setStyleSheet("color: #FF5555;")
            self.launch_button.setEnabled(True)
            self.close_button.setEnabled(False)

            self.log_message("服务器已关闭", "success")
        except Exception as e:
            self.log_message(f"关闭失败: {str(e)}", "error")
            QMessageBox.critical(self, "错误", f"关闭服务器失败: {str(e)}")
    
    def read_output(self):
        """在线程中读取进程的标准输出"""
        try:
            for line in iter(self.process.stdout.readline, ''):
                if line:
                    self.signals.output.emit(line.strip())
        except Exception as e:
            self.signals.error.emit(f"读取输出出错: {str(e)}")
        finally:
            self.process.stdout.close()
    
    def read_error(self):
        """在线程中读取进程的错误输出"""
        try:
            for line in iter(self.process.stderr.readline, ''):
                if line:
                    self.signals.error.emit(line.strip())
        except Exception as e:
            self.signals.error.emit(f"读取错误输出出错: {str(e)}")
        finally:
            self.process.stderr.close()
            self.signals.finished.emit()
    
    def update_output(self, text):
        """更新标准输出到UI"""
        self.log_message(text, "normal")
    
    def update_error(self, text):
        """更新错误输出到UI"""
        self.log_message(text, "error")
    
    def process_finished(self):
        """进程结束的处理"""
        self.process_running = False
        self.status_label.setText("未启动")
        self.status_label.setStyleSheet("color: #FF5555;")
        self.log_message("服务器进程已结束", "normal")
        self.launch_button.setEnabled(True)
        self.close_button.setEnabled(False)
    
    def log_message(self, message, msg_type="normal"):
        """向输出框添加消息"""
        self.output_text.moveCursor(self.output_text.textCursor().End)
        
        # 设置文本颜色
        if msg_type == "error":
            self.output_text.setTextColor(QColor("#FF5555"))  # 红色
        elif msg_type == "success":
            self.output_text.setTextColor(QColor("#55FF55"))  # 绿色
        else:
            self.output_text.setTextColor(QColor("#CCCCCC"))  # 灰白色
        
        # 添加消息和时间戳
        timestamp = time.strftime("%H:%M:%S", time.localtime())
        self.output_text.insertPlainText(f"[{timestamp}] {message}\n")
        
        # 恢复默认颜色
        self.output_text.setTextColor(QColor("#CCCCCC"))
        
        # 滚动到底部
        self.output_text.ensureCursorVisible()
    
    def clear_output(self):
        """清空输出框"""
        self.output_text.clear()
        self.log_message("日志已清空", "normal")
    
    def check_process_status(self):
        """检查进程状态"""
        if self.process_running and self.process:
            # 检查进程是否仍在运行
            if self.process.poll() is not None:  # 返回值不为None表示进程已结束
                self.process_running = False
                self.status_label.setText("未启动")
                self.status_label.setStyleSheet("color: #FF5555;")
                self.log_message("检测到服务器进程已结束", "normal")
                self.launch_button.setEnabled(True)
                self.close_button.setEnabled(False)
    
    def load_config(self, config):
        # 从配置中加载选项
        self.auto_start.setChecked(config.get("auto_start", False))
        self.hide_cmd.setChecked(config.get("hide_cmd", True))
        
        # 服务器目录
        if config.get("server_dir"):
            self.server_dir = config.get("server_dir")
        
        # 如果设置了自动启动，则启动服务器
        if config.get("auto_start", False):
            # 延迟启动，确保UI已完全加载
            QTimer.singleShot(2000, self.launch_server)
    
    def get_config(self):
        return {
            "auto_start": self.auto_start.isChecked(),
            "hide_cmd": self.hide_cmd.isChecked(),
            "server_dir": self.server_dir
        }