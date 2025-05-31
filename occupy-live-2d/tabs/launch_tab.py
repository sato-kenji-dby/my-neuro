import os
import subprocess
import time
import threading
from PyQt5.QtWidgets import (QHBoxLayout, QVBoxLayout, QLabel,
                             QPushButton, QCheckBox, QMessageBox,
                             QTextEdit, QGroupBox, QSizePolicy, QFrame)  # 添加 QFrame
from PyQt5.QtCore import Qt, QTimer, pyqtSignal, QObject
from PyQt5.QtGui import QFont, QColor
from tabs.base_tab import BaseTab


class ProcessSignals(QObject):
    """进程输出信号类，用于从子线程向主线程发送信号"""
    output = pyqtSignal(str)
    error = pyqtSignal(str)
    finished = pyqtSignal()


class LaunchTab(BaseTab):
    """启动设置标签页 - 整合MCP功能"""

    def __init__(self):
        super().__init__(title="启动")
        self.process = None
        self.process_running = False
        self.mcp_running = False
        self.last_launch_time = 0
        self.signals = ProcessSignals()
        self.signals.output.connect(self.update_output)
        self.signals.error.connect(self.update_error)
        self.signals.finished.connect(self.process_finished)

        # 使用默认的启动命令和工作目录
        self.cmd = ".\\node\\node.exe .\\node_modules\\electron\\cli.js ."
        self.work_dir = os.getcwd()  # 默认使用当前目录

        # MCP相关设置 - 修改为相对路径
        self.server_dir = "server-tools"  # 修改这行为相对路径
        self.server_url = "http://localhost:3000"
        self.mcp_enabled = True
        self.mcp_process = None

        # 始终隐藏CMD窗口
        self.hide_cmd = True

    def init_ui(self):
        # 创建顶部设置的水平布局
        top_settings_layout = QHBoxLayout()
        top_settings_layout.setContentsMargins(0, 0, 0, 0)  # 减小边距到0
        top_settings_layout.setSpacing(20)  # 水平间距设为20

        # 左侧：MCP启用选项 (交换位置)
        self.mcp_enabled_checkbox = QCheckBox("启用MCP功能")
        self.mcp_enabled_checkbox.setChecked(True)
        top_settings_layout.addWidget(self.mcp_enabled_checkbox)

        # 添加弹性空间
        top_settings_layout.addStretch()

        # 右侧：自动启动选项 (交换位置)
        self.auto_start = QCheckBox("启动程序时自动启动桌宠")
        top_settings_layout.addWidget(self.auto_start)

        # 将顶部设置布局添加到主布局
        self.form_layout.addLayout(top_settings_layout)

        # 添加一条细分隔线
        separator = QFrame()
        separator.setFrameShape(QFrame.HLine)
        separator.setFrameShadow(QFrame.Sunken)
        separator.setLineWidth(1)  # 更细的线
        separator.setMidLineWidth(0)
        separator.setStyleSheet("background-color: rgba(200, 190, 180, 100);")  # 半透明浅色
        self.form_layout.addWidget(separator)
        self.form_layout.addSpacing(5)  # 添加一点额外空间

        # ======== 启动和关闭按钮 ========
        buttons_layout = QHBoxLayout()
        buttons_layout.setContentsMargins(0, 0, 0, 0)  # 减小边距到0

        # 启动按钮
        self.launch_button = QPushButton("启动桌宠")
        self.launch_button.setMinimumHeight(45)  # 按钮高度
        self.launch_button.setStyleSheet("""
            QPushButton {
                background-color: rgba(142, 186, 140, 230);
                font-size: 16px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: rgba(162, 206, 160, 230);
            }
            QPushButton:pressed {
                background-color: rgba(122, 166, 120, 230);
            }
        """)
        self.launch_button.clicked.connect(self.launch_app_with_mcp)
        buttons_layout.addWidget(self.launch_button)

        # 关闭按钮
        self.close_button = QPushButton("关闭桌宠")
        self.close_button.setMinimumHeight(45)  # 按钮高度
        self.close_button.setStyleSheet("""
            QPushButton {
                background-color: rgba(205, 140, 135, 230);
                font-size: 16px;
                font-weight: bold;
            }
            QPushButton:hover {
                background-color: rgba(225, 160, 155, 230);
            }
            QPushButton:pressed {
                background-color: rgba(185, 120, 115, 230);
            }
            QPushButton:disabled {
                background-color: rgba(220, 205, 200, 230);
            }
        """)
        self.close_button.clicked.connect(self.close_all)
        self.close_button.setEnabled(True)
        buttons_layout.addWidget(self.close_button)

        # 将按钮布局添加到主布局
        self.form_layout.addLayout(buttons_layout)

        # 状态和清空按钮放在一行
        status_layout = QHBoxLayout()
        status_layout.setContentsMargins(0, 0, 0, 0)  # 减小边距到0

        status_layout.addWidget(QLabel("状态:"))
        self.status_label = QLabel("未启动")
        self.status_label.setStyleSheet("color: #FF5555;")
        status_layout.addWidget(self.status_label)
        status_layout.addStretch()

        # 清空按钮
        clear_button = QPushButton("清空日志")
        clear_button.clicked.connect(self.clear_output)
        status_layout.addWidget(clear_button)

        self.form_layout.addLayout(status_layout)

        # 添加一条细分隔线
        separator2 = QFrame()
        separator2.setFrameShape(QFrame.HLine)
        separator2.setFrameShadow(QFrame.Sunken)
        separator2.setLineWidth(1)  # 更细的线
        separator2.setMidLineWidth(0)
        separator2.setStyleSheet("background-color: rgba(200, 190, 180, 100);")  # 半透明浅色
        self.form_layout.addWidget(separator2)
        self.form_layout.addSpacing(5)  # 添加一点额外空间

        # ======== 日志部分 - 直接使用水平布局 ========
        # 创建水平布局来放置两个日志区域
        logs_horizontal_layout = QHBoxLayout()
        logs_horizontal_layout.setContentsMargins(0, 0, 0, 0)  # 减小边距到0
        logs_horizontal_layout.setSpacing(10)  # 设置两个日志区域之间的间距

        # 桌宠日志
        app_log_layout = QVBoxLayout()
        app_log_layout.setContentsMargins(0, 0, 0, 0)  # 减小边距到0
        app_log_layout.setSpacing(3)  # 减小垂直间距
        app_log_label = QLabel("桌宠日志")
        app_log_label.setFont(QFont("Microsoft YaHei", 10, QFont.Bold))
        app_log_layout.addWidget(app_log_label)

        self.app_output_text = QTextEdit()
        self.app_output_text.setReadOnly(True)
        self.app_output_text.setStyleSheet("""
            background-color: rgba(248, 248, 252, 230);
            color: #505050;
            border: 1px solid rgba(200, 200, 210, 230);
        """)
        # 进一步增加最小高度
        self.app_output_text.setMinimumHeight(450)  # 更大的高度
        # 设置大的首选高度
        self.app_output_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        app_log_layout.addWidget(self.app_output_text)

        # MCP日志
        mcp_log_layout = QVBoxLayout()
        mcp_log_layout.setContentsMargins(0, 0, 0, 0)  # 减小边距到0
        mcp_log_layout.setSpacing(3)  # 减小垂直间距
        mcp_log_label = QLabel("MCP服务日志")
        mcp_log_label.setFont(QFont("Microsoft YaHei", 10, QFont.Bold))
        mcp_log_layout.addWidget(mcp_log_label)

        self.mcp_output_text = QTextEdit()
        self.mcp_output_text.setReadOnly(True)
        self.mcp_output_text.setStyleSheet("""
            background-color: rgba(248, 248, 252, 230);
            color: #505050;
            border: 1px solid rgba(200, 200, 210, 230);
        """)
        # 进一步增加最小高度
        self.mcp_output_text.setMinimumHeight(450)  # 更大的高度
        # 设置大的首选高度
        self.mcp_output_text.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        mcp_log_layout.addWidget(self.mcp_output_text)

        # 将两个日志布局添加到水平布局中
        logs_horizontal_layout.addLayout(app_log_layout)
        logs_horizontal_layout.addLayout(mcp_log_layout)

        # 将水平布局直接添加到主布局
        self.form_layout.addLayout(logs_horizontal_layout)

        # 启动定时器用于检查进程状态
        self.check_timer = QTimer()
        self.check_timer.timeout.connect(self.check_process_status)
        self.check_timer.start(2000)  # 每2秒检查一次

    def launch_mcp_server(self):
        """启动MCP服务器"""
        if not self.mcp_enabled_checkbox.isChecked():
            self.log_message("MCP功能已禁用，跳过MCP服务器启动", "normal", is_mcp=True)
            return True

        try:
            # 检查服务器目录是否存在
            server_dir_abs = os.path.abspath(self.server_dir)
            if not os.path.exists(server_dir_abs):
                self.log_message(f"服务器目录不存在: {server_dir_abs}", "error", is_mcp=True)
                return False

            # 检查node.exe是否存在
            parent_dir = os.path.dirname(server_dir_abs)
            node_path = os.path.join(parent_dir, "node", "node.exe")
            if not os.path.exists(node_path):
                self.log_message(f"找不到Node.exe: {node_path}", "error", is_mcp=True)
                return False

            # 创建启动脚本 - 使用GBK编码，这是CMD默认编码
            bat_path = os.path.join(server_dir_abs, "start_server.bat")
            with open(bat_path, "w", encoding="gbk") as f:
                f.write("@echo off\n")
                f.write("cd /d %~dp0\n")
                f.write("echo 正在启动MCP服务器...\n")
                f.write("\"..\\node\\node.exe\" server.js\n")
                f.write("if %ERRORLEVEL% NEQ 0 pause\n")
                f.write("exit\n")

            self.log_message("正在启动MCP服务器...", "normal", is_mcp=True)

            # 改用二进制模式而不是文本模式
            if self.hide_cmd:
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 0

                self.mcp_process = subprocess.Popen(
                    bat_path,
                    cwd=server_dir_abs,
                    shell=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    startupinfo=startupinfo,
                    # 关键变化: 不使用universal_newlines，不指定encoding
                    # 使用二进制模式读取输出
                    universal_newlines=False,
                    bufsize=0,  # 无缓冲
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
                )

                # 启动线程来读取输出
                threading.Thread(target=self.read_mcp_output, daemon=True).start()
                threading.Thread(target=self.read_mcp_error, daemon=True).start()
            else:
                # 直接显示CMD窗口的代码保持不变
                self.mcp_process = subprocess.Popen(
                    bat_path,
                    cwd=server_dir_abs,
                    shell=True,
                    creationflags=subprocess.CREATE_NEW_PROCESS_GROUP
                )

            self.mcp_running = True
            self.log_message("MCP服务器已启动", "success", is_mcp=True)
            time.sleep(1)
            return True

        except Exception as e:
            self.log_message(f"MCP启动失败: {str(e)}", "error", is_mcp=True)
            return False

    def launch_app_with_mcp(self):
        """启动桌宠应用并同时启动MCP服务器"""
        # 检查是否已经在运行
        if self.process_running:
            QMessageBox.information(self, "提示", "桌宠已经在运行中")
            return

        # 检查两次启动之间的时间间隔，防止短时间内多次点击
        current_time = time.time()
        if current_time - self.last_launch_time < 3:  # 设置3秒的冷却时间
            QMessageBox.information(self, "提示", "请稍后再试")
            return

        self.last_launch_time = current_time

        # 先启动MCP服务器
        mcp_started = True
        if self.mcp_enabled_checkbox.isChecked():
            mcp_started = self.launch_mcp_server()

        # 如果MCP启动失败并且MCP是启用的，询问用户是否继续
        if not mcp_started and self.mcp_enabled_checkbox.isChecked():
            result = QMessageBox.question(self, "MCP启动失败",
                                          "MCP服务器启动失败，是否仍要启动桌宠？",
                                          QMessageBox.Yes | QMessageBox.No)
            if result == QMessageBox.No:
                return

        # 启动桌宠应用
        try:
            # 创建启动脚本
            bat_path = os.path.join(self.work_dir, "launch_live2d.bat")
            with open(bat_path, "w", encoding="utf-8") as f:
                f.write("@echo off\n")
                f.write("chcp 65001\n")
                f.write("cd /d %~dp0\n")
                f.write("echo 正在启动桌宠应用...\n")
                f.write(f"{self.cmd}\n")
                f.write("if %ERRORLEVEL% NEQ 0 pause\n")  # 出错时暂停
                f.write("exit\n")

            self.log_message("正在启动桌宠应用...", "normal")

            # 始终隐藏CMD窗口
            if self.hide_cmd:
                # 使用subprocess.PIPE捕获输出
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = 0  # SW_HIDE

                self.process = subprocess.Popen(
                    bat_path,
                    cwd=self.work_dir,
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
                    cwd=self.work_dir,
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
            self.log_message(f"桌宠启动失败: {str(e)}", "error")
            QMessageBox.critical(self, "错误", f"启动桌宠失败: {str(e)}")

    def close_all(self):
        """关闭所有相关进程"""
        if not self.process_running and not self.mcp_running:
            QMessageBox.information(self, "提示", "没有正在运行的进程")
            return

        try:
            self.log_message("正在关闭所有进程...", "normal")

            # 使用taskkill命令关闭所有node.exe进程
            subprocess.call('taskkill /F /IM node.exe', shell=True)

            # 更新UI状态
            self.process_running = False
            self.mcp_running = False
            self.status_label.setText("已关闭")
            self.status_label.setStyleSheet("color: #FF5555;")
            self.launch_button.setEnabled(True)
            self.close_button.setEnabled(False)

            self.log_message("所有进程已关闭", "success")
            self.log_message("所有进程已关闭", "success", is_mcp=True)

        except Exception as e:
            error_msg = f"关闭进程失败: {str(e)}"
            self.log_message(error_msg, "error")
            self.log_message(error_msg, "error", is_mcp=True)
            QMessageBox.critical(self, "错误", error_msg)

    def read_output(self):
        """在线程中读取桌宠进程的标准输出"""
        if not self.process or not hasattr(self.process, 'stdout'):
            return

        try:
            for line in iter(self.process.stdout.readline, ''):
                if line:
                    self.signals.output.emit(line.strip())
        except Exception as e:
            self.signals.error.emit(f"读取输出出错: {str(e)}")
        finally:
            if self.process and hasattr(self.process, 'stdout'):
                self.process.stdout.close()

    def read_error(self):
        """在线程中读取桌宠进程的错误输出"""
        if not self.process or not hasattr(self.process, 'stderr'):
            return

        try:
            for line in iter(self.process.stderr.readline, ''):
                if line:
                    self.signals.error.emit(line.strip())
        except Exception as e:
            self.signals.error.emit(f"读取错误输出出错: {str(e)}")
        finally:
            if self.process and hasattr(self.process, 'stderr'):
                self.process.stderr.close()
                self.signals.finished.emit()

    def read_mcp_output(self):
        """读取MCP服务器的标准输出"""
        if not hasattr(self, 'mcp_process') or not self.mcp_process or not hasattr(self.mcp_process, 'stdout'):
            return

        try:
            # 使用二进制模式读取
            while True:
                line = self.mcp_process.stdout.readline()
                if not line:
                    break

                # 尝试多种编码方式直到成功
                text = None
                for encoding in ['utf-8', 'gbk', 'latin-1']:
                    try:
                        text = line.decode(encoding).strip()
                        break
                    except UnicodeDecodeError:
                        continue

                if text:
                    self.log_message(text, "normal", is_mcp=True)
                else:
                    # 如果所有编码都失败，使用十六进制表示
                    hex_text = ' '.join(f'{b:02x}' for b in line)
                    self.log_message(f"[Binary data]: {hex_text}", "normal", is_mcp=True)
        except Exception as e:
            self.log_message(f"读取MCP输出出错: {str(e)}", "error", is_mcp=True)

    def read_mcp_error(self):
        """读取MCP服务器的错误输出"""
        if not hasattr(self, 'mcp_process') or not self.mcp_process or not hasattr(self.mcp_process, 'stderr'):
            return

        try:
            # 使用二进制模式读取
            while True:
                line = self.mcp_process.stderr.readline()
                if not line:
                    break

                # 尝试多种编码方式直到成功
                text = None
                for encoding in ['utf-8', 'gbk', 'latin-1']:
                    try:
                        text = line.decode(encoding).strip()
                        break
                    except UnicodeDecodeError:
                        continue

                if text:
                    self.log_message(text, "error", is_mcp=True)
                else:
                    # 如果所有编码都失败，使用十六进制表示
                    hex_text = ' '.join(f'{b:02x}' for b in line)
                    self.log_message(f"[Binary data]: {hex_text}", "error", is_mcp=True)
        except Exception as e:
            self.log_message(f"读取MCP错误输出出错: {str(e)}", "error", is_mcp=True)

    def update_output(self, text):
        """更新桌宠标准输出到UI"""
        self.log_message(text, "normal")

    def update_error(self, text):
        """更新桌宠错误输出到UI"""
        self.log_message(text, "error")

    def process_finished(self):
        """桌宠进程结束的处理"""
        self.process_running = False
        if not self.mcp_running:  # 只有当MCP也不在运行时才更新状态
            self.status_label.setText("未启动")
            self.status_label.setStyleSheet("color: #FF5555;")
        self.log_message("桌宠进程已结束", "normal")

    def log_message(self, message, msg_type="normal", is_mcp=False):
        """向输出框添加消息"""
        # 选择正确的输出窗口
        output_text = self.mcp_output_text if is_mcp else self.app_output_text
        output_text.moveCursor(output_text.textCursor().End)

        # 设置文本颜色
        if msg_type == "error":
            output_text.setTextColor(QColor("#D32F2F"))  # 红色
        elif msg_type == "success":
            output_text.setTextColor(QColor("#388E3C"))  # 绿色
        else:
            output_text.setTextColor(QColor("#505050"))  # 深灰色

        # 添加消息和时间戳
        timestamp = time.strftime("%H:%M:%S", time.localtime())
        output_text.insertPlainText(f"[{timestamp}] {message}\n")

        # 恢复默认颜色
        output_text.setTextColor(QColor("#505050"))

        # 滚动到底部
        output_text.ensureCursorVisible()

    def clear_output(self):
        """清空所有日志"""
        self.app_output_text.clear()
        self.mcp_output_text.clear()
        self.log_message("桌宠日志已清空", "normal")
        self.log_message("MCP日志已清空", "normal", is_mcp=True)

    def check_process_status(self):
        """检查进程状态"""
        node_running = False

        # 使用tasklist检查是否有node.exe进程正在运行
        try:
            result = subprocess.run(['tasklist', '/FI', 'IMAGENAME eq node.exe'],
                                    capture_output=True, text=True, shell=True)
            node_running = 'node.exe' in result.stdout
        except Exception:
            # 如果检查失败，假设进程可能仍在运行
            node_running = self.process_running or self.mcp_running

        # 如果没有node进程在运行，但我们认为有进程在运行，则更新状态
        if not node_running and (self.process_running or self.mcp_running):
            self.process_running = False
            self.mcp_running = False
            self.status_label.setText("未启动")
            self.status_label.setStyleSheet("color: #FF5555;")
            self.log_message("检测到所有进程已结束", "normal")
            self.launch_button.setEnabled(True)
            self.close_button.setEnabled(False)

    def load_config(self, config):
        # 从配置中加载自动启动选项
        self.auto_start.setChecked(config.get("auto_start", False))

        # 始终设置隐藏CMD窗口为True
        self.hide_cmd = True

        # 加载命令和工作目录
        self.cmd = config.get("cmd", ".\\node\\node.exe .\\node_modules\\electron\\cli.js .")
        self.work_dir = config.get("work_dir", "")
        if not self.work_dir:
            self.work_dir = os.getcwd()

        # 获取MCP配置
        try:
            # 从父窗口或全局config获取MCP配置
            from config_manager import ConfigManager
            config_manager = ConfigManager()
            all_config = config_manager.load_config()
            if "mcp" in all_config:
                mcp_config = all_config["mcp"]
                self.mcp_enabled_checkbox.setChecked(mcp_config.get("enabled", True))
                # 固定服务器URL
                self.server_url = "http://localhost:3000"
        except Exception as e:
            self.log_message(f"加载MCP配置失败: {str(e)}", "error", is_mcp=True)

        # 如果设置了自动启动，则启动应用
        if config.get("auto_start", False):
            # 延迟启动，确保UI已完全加载
            QTimer.singleShot(2000, self.launch_app_with_mcp)

    def get_config(self):
        # 只返回原来launch配置部分的内容
        return {
            "cmd": self.cmd,
            "work_dir": self.work_dir,
            "auto_start": self.auto_start.isChecked(),
            "hide_cmd": True  # 始终返回True
        }

    def get_mcp_config(self):
        # 单独获取MCP配置，供外部调用
        return {
            "enabled": self.mcp_enabled_checkbox.isChecked(),
            "server_url": "http://localhost:3000"  # 固定返回此URL
        }