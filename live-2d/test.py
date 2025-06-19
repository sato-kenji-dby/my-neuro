import json
import sys
from PyQt5.QtWidgets import *
from PyQt5.QtCore import *
from PyQt5.QtGui import *
from PyQt5 import uic
import subprocess


class ToastNotification(QLabel):
    """自定义Toast提示"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.setAlignment(Qt.AlignCenter)
        self.setStyleSheet("""
            QLabel {
                background: qlineargradient(x1:0, y1:0, x2:1, y2:0, 
                    stop:0 rgba(255, 255, 255, 240), 
                    stop:1 rgba(248, 248, 248, 240));
                color: rgb(60, 60, 60);
                border: 1px solid rgba(200, 200, 200, 150);
                border-radius: 15px;
                padding: 18px 36px;
                font-size: 16px;
                font-family: "Microsoft YaHei";
                font-weight: normal;
            }
        """)
        self.hide()

        # 创建动画效果
        self.effect = QGraphicsOpacityEffect()
        self.setGraphicsEffect(self.effect)

        self.slide_animation = QPropertyAnimation(self, b"pos")
        self.slide_animation.setDuration(300)
        self.slide_animation.setEasingCurve(QEasingCurve.OutCubic)

        self.opacity_animation = QPropertyAnimation(self.effect, b"opacity")
        self.opacity_animation.setDuration(300)

    def show_message(self, message, duration=2000):
        """显示消息，duration为显示时长（毫秒）"""
        self.setText(message)
        self.adjustSize()

        # 计算位置
        parent = self.parent()
        if parent:
            x = (parent.width() - self.width()) // 2
            start_y = -self.height()  # 从顶部外面开始
            end_y = 20  # 最终位置距离顶部20像素

            # 设置起始位置
            self.move(x, start_y)
            self.show()
            self.raise_()

            # 滑入动画
            self.slide_animation.setStartValue(QPoint(x, start_y))
            self.slide_animation.setEndValue(QPoint(x, end_y))

            # 透明度渐入
            self.opacity_animation.setStartValue(0.0)
            self.opacity_animation.setEndValue(1.0)

            # 开始动画
            self.slide_animation.start()
            self.opacity_animation.start()

            # 延迟后滑出
            QTimer.singleShot(duration, self.hide_with_animation)

    def hide_with_animation(self):
        """带动画的隐藏"""
        parent = self.parent()
        if parent:
            current_pos = self.pos()
            end_y = -self.height()

            # 滑出动画
            self.slide_animation.setStartValue(current_pos)
            self.slide_animation.setEndValue(QPoint(current_pos.x(), end_y))

            # 透明度渐出
            self.opacity_animation.setStartValue(1.0)
            self.opacity_animation.setEndValue(0.0)

            # 动画完成后隐藏
            self.slide_animation.finished.connect(self.hide)

            # 开始动画
            self.slide_animation.start()
            self.opacity_animation.start()


class CustomTitleBar(QWidget):
    """自定义标题栏"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent = parent
        self.setFixedHeight(55)
        self.setStyleSheet("""
           CustomTitleBar {
               background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 rgba(235, 233, 225, 255), stop:1 rgba(230, 228, 220, 255));
               border: none;
               border-radius: 25px 25px 0px 0px;
           }
       """)
        self.init_ui()

    def init_ui(self):
        layout = QHBoxLayout(self)
        layout.setContentsMargins(20, 0, 5, 0)
        layout.setSpacing(0)

        # 标题
        self.title_label = QLabel()
        self.title_label.setStyleSheet("""
           QLabel {
               color: rgb(114, 95, 77);
               font-size: 12px;
               font-family: "Microsoft YaHei";
               font-weight: bold;
               background-color: transparent;
           }
       """)

        layout.addWidget(self.title_label)
        layout.addStretch()

        # 窗口控制按钮
        button_style = """
           QPushButton {
               background-color: transparent;
               border: none;
               width: 45px;
               height: 40px;
               font-size: 14px;
               font-weight: bold;
               color: rgb(114, 95, 77);
           }
           QPushButton:hover {
               background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 rgba(200, 195, 185, 255), stop:1 rgba(180, 175, 165, 255));
               color: rgb(40, 35, 25);
               border-radius: 5px;
           }
       """

        close_style = """
           QPushButton {
               background-color: transparent;
               border: none;
               width: 45px;
               height: 40px;
               font-size: 14px;
               font-weight: bold;
               color: rgb(114, 95, 77);
           }
           QPushButton:hover {
               background: qlineargradient(x1:0, y1:0, x2:1, y2:0, stop:0 rgba(255, 182, 193, 255), stop:1 rgba(255, 160, 122, 255));
               color: rgb(139, 69, 19);
               border-radius: 5px;
           }
       """

        # 最小化按钮
        self.min_btn = QPushButton("−")
        self.min_btn.setStyleSheet(button_style)
        self.min_btn.clicked.connect(self.parent.showMinimized)

        # 最大化/还原按钮
        self.max_btn = QPushButton("□")
        self.max_btn.setStyleSheet(button_style)
        self.max_btn.clicked.connect(self.toggle_maximize)

        # 关闭按钮
        self.close_btn = QPushButton("×")
        self.close_btn.setStyleSheet(close_style)
        self.close_btn.clicked.connect(self.parent.close)

        layout.addWidget(self.min_btn)
        layout.addWidget(self.max_btn)
        layout.addWidget(self.close_btn)

    def toggle_maximize(self):
        """切换最大化状态"""
        if self.parent.isMaximized():
            self.parent.showNormal()
            self.max_btn.setText("□")
        else:
            self.parent.showMaximized()
            self.max_btn.setText("◱")

    def mousePressEvent(self, event):
        """鼠标按下事件 - 用于拖拽窗口"""
        if event.button() == Qt.LeftButton:
            self.drag_pos = event.globalPos() - self.parent.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        """鼠标移动事件 - 拖拽窗口"""
        if event.buttons() == Qt.LeftButton and hasattr(self, 'drag_pos'):
            self.parent.move(event.globalPos() - self.drag_pos)
            event.accept()

    def mouseDoubleClickEvent(self, event):
        """双击标题栏最大化/还原"""
        if event.button() == Qt.LeftButton:
            self.toggle_maximize()


class set_pyqt(QWidget):
    # 添加信号用于线程安全的日志更新
    log_signal = pyqtSignal(str)
    mcp_log_signal = pyqtSignal(str)

    def __init__(self):
        super().__init__()
        self.live2d_process = None
        self.mcp_process = None
        self.config_path = 'config.json'
        self.config = self.load_config()

        # 调整大小相关变量
        self.resizing = False
        self.resize_edge = None
        self.resize_start_pos = None
        self.resize_start_geometry = None
        self.edge_margin = 10

        self.init_ui()

    def init_ui(self):
        # 设置无边框
        self.setWindowFlags(Qt.FramelessWindowHint)

        # 启用透明背景
        self.setAttribute(Qt.WA_TranslucentBackground)

        # 启用鼠标跟踪
        self.setMouseTracking(True)

        # 为整个应用安装事件过滤器
        app = QApplication.instance()
        app.installEventFilter(self)

        # 添加圆角样式 - 改为浅色渐变
        self.setStyleSheet("""
            QWidget {
                border-radius: 25px;
                background: qlineargradient(x1:0, y1:0, x2:1, y2:1, stop:0 rgba(250, 249, 245, 255), stop:0.5 rgba(245, 243, 235, 255), stop:1 rgba(240, 238, 230, 255));
            }
        """)

        # 加载原始UI文件
        self.ui = uic.loadUi('test222.ui')

        # 隐藏状态栏
        self.ui.statusbar.hide()

        # 创建一个容器来装标题栏和原UI
        container = QWidget()
        container_layout = QVBoxLayout(container)
        container_layout.setContentsMargins(0, 0, 0, 0)
        container_layout.setSpacing(0)

        # 添加自定义标题栏
        self.title_bar = CustomTitleBar(self)
        container_layout.addWidget(self.title_bar)

        # 添加原始UI
        container_layout.addWidget(self.ui)

        # 设置主布局
        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.addWidget(container)

        # 设置窗口大小
        self.resize(1800, 1200)

        # 设置最小尺寸为1x1，允许任意缩小
        self.setMinimumSize(1, 1)

        # 保持原来的功能
        self.set_btu()
        self.set_config()

        # 修改复选框布局为水平布局
        self.modify_checkbox_layout()

        # 创建Toast提示
        self.toast = ToastNotification(self)

        # 连接日志信号
        self.log_signal.connect(self.update_log)
        self.mcp_log_signal.connect(self.update_mcp_log)

    def update_log(self, text):
        """更新日志到UI（在主线程中执行）"""
        self.ui.textEdit_2.append(text)

    def update_mcp_log(self, text):
        """更新MCP日志到UI（在主线程中执行）"""
        self.ui.textEdit.append(text)

    def eventFilter(self, obj, event):
        """全局事件过滤器 - 捕获所有鼠标事件"""
        if event.type() == QEvent.MouseMove:
            # 将全局坐标转换为窗口本地坐标
            if self.isVisible():
                local_pos = self.mapFromGlobal(QCursor.pos())

                if self.resizing and self.resize_edge:
                    self.do_resize(QCursor.pos())
                    return True
                else:
                    # 更新光标
                    edge = self.get_resize_edge(local_pos)
                    if edge and self.rect().contains(local_pos):
                        self.setCursor(self.get_resize_cursor(edge))
                    else:
                        self.setCursor(Qt.ArrowCursor)

        elif event.type() == QEvent.MouseButtonPress:
            if event.button() == Qt.LeftButton and self.isVisible():
                local_pos = self.mapFromGlobal(QCursor.pos())
                if self.rect().contains(local_pos):
                    self.resize_edge = self.get_resize_edge(local_pos)
                    if self.resize_edge:
                        self.resizing = True
                        self.resize_start_pos = QCursor.pos()
                        self.resize_start_geometry = self.geometry()
                        return True

        elif event.type() == QEvent.MouseButtonRelease:
            if event.button() == Qt.LeftButton and self.resizing:
                self.resizing = False
                self.resize_edge = None
                self.setCursor(Qt.ArrowCursor)
                return True

        return super().eventFilter(obj, event)

    def modify_checkbox_layout(self):
        """修改复选框布局为水平布局"""
        # 找到启动页面
        page = self.ui.page
        page_layout = page.layout()

        # 移除原来的垂直布局中的复选框
        checkbox_mcp = self.ui.checkBox_mcp
        checkbox_vision = self.ui.checkBox_5

        # 从原布局中移除
        page_layout.removeWidget(checkbox_mcp)
        page_layout.removeWidget(checkbox_vision)

        # 创建新的水平布局
        checkbox_layout = QHBoxLayout()
        checkbox_layout.setSpacing(30)
        checkbox_layout.addWidget(checkbox_mcp)
        checkbox_layout.addWidget(checkbox_vision)
        checkbox_layout.addStretch()  # 添加弹性空间

        # 将水平布局插入到原来的位置（在按钮布局之后）
        page_layout.insertLayout(1, checkbox_layout)

    def get_resize_edge(self, pos):
        """判断鼠标是否在边缘 - 只检测四个角"""
        rect = self.rect()
        x, y = pos.x(), pos.y()

        # 检查是否在边缘
        left = x <= self.edge_margin
        right = x >= rect.width() - self.edge_margin
        top = y <= self.edge_margin
        bottom = y >= rect.height() - self.edge_margin

        # 只返回四个角的情况
        if top and left:
            return 'top-left'
        elif top and right:
            return 'top-right'
        elif bottom and left:
            return 'bottom-left'
        elif bottom and right:
            return 'bottom-right'
        return None

    def get_resize_cursor(self, edge):
        """根据边缘返回光标样式"""
        cursor_map = {
            'top': Qt.SizeVerCursor,
            'bottom': Qt.SizeVerCursor,
            'left': Qt.SizeHorCursor,
            'right': Qt.SizeHorCursor,
            'top-left': Qt.SizeFDiagCursor,
            'top-right': Qt.SizeBDiagCursor,
            'bottom-left': Qt.SizeBDiagCursor,
            'bottom-right': Qt.SizeFDiagCursor,
        }
        return cursor_map.get(edge, Qt.ArrowCursor)

    def mousePressEvent(self, event):
        # 这些方法保留，但主要逻辑在eventFilter中
        super().mousePressEvent(event)

    def mouseMoveEvent(self, event):
        # 这些方法保留，但主要逻辑在eventFilter中
        super().mouseMoveEvent(event)

    def mouseReleaseEvent(self, event):
        # 这些方法保留，但主要逻辑在eventFilter中
        super().mouseReleaseEvent(event)

    def do_resize(self, global_pos):
        """执行窗口调整大小"""
        if not self.resize_start_pos or not self.resize_start_geometry:
            return

        delta = global_pos - self.resize_start_pos
        geo = QRect(self.resize_start_geometry)

        # 处理水平调整
        if 'left' in self.resize_edge:
            geo.setLeft(geo.left() + delta.x())
            geo.setWidth(geo.width() - delta.x())
        elif 'right' in self.resize_edge:
            geo.setWidth(geo.width() + delta.x())

        # 处理垂直调整
        if 'top' in self.resize_edge:
            geo.setTop(geo.top() + delta.y())
            geo.setHeight(geo.height() - delta.y())
        elif 'bottom' in self.resize_edge:
            geo.setHeight(geo.height() + delta.y())

        self.setGeometry(geo)

    def set_btu(self):
        self.ui.pushButton.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(1))
        self.ui.pushButton_3.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(0))
        self.ui.pushButton_2.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(4))
        self.ui.pushButton_5.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(2))
        self.ui.pushButton_6.clicked.connect(lambda: self.ui.stackedWidget.setCurrentIndex(3))
        self.ui.saveConfigButton.clicked.connect(self.save_config)
        self.ui.pushButton_8.clicked.connect(self.start_live_2d)
        self.ui.pushButton_7.clicked.connect(self.close_live_2d)
        # 添加清空日志按钮的绑定
        self.ui.pushButton_clearLog.clicked.connect(self.clear_logs)

    def clear_logs(self):
        """清空日志功能"""
        # 清空桌宠日志
        self.ui.textEdit_2.clear()
        # 清空MCP日志
        self.ui.textEdit.clear()
        # 显示提示
        self.toast.show_message("日志已清空", 1500)

    def set_config(self):
        self.ui.lineEdit.setText(self.config['llm']['api_key'])
        self.ui.lineEdit_2.setText(self.config['llm']['api_url'])
        self.ui.lineEdit_3.setText(self.config['llm']['model'])
        self.ui.textEdit_3.setPlainText(self.config['llm']['system_prompt'])
        self.ui.lineEdit_4.setText(self.config['ui']['intro_text'])
        self.ui.lineEdit_5.setText(str(self.config['context']['max_messages']))
        self.ui.lineEdit_interval.setText(str(self.config['auto_chat']['interval']))
        self.ui.lineEdit_idle_time.setText(str(self.config['auto_chat']['idle_time']))
        self.ui.lineEdit_6.setText(str(self.config['bilibili']['roomId']))
        self.ui.checkBox_mcp.setChecked(self.config['mcp']['enabled'])
        self.ui.checkBox_5.setChecked(self.config['vision']['auto_screenshot'])
        self.ui.checkBox_3.setChecked(self.config['ui']['show_chat_box'])
        self.ui.checkBox_4.setChecked(self.config['context']['enable_limit'])
        self.ui.checkBox.setChecked(self.config['auto_chat']['enabled'])
        self.ui.checkBox_2.setChecked(self.config['bilibili']['enabled'])

    def start_live_2d(self):
        # 检查是否已经有桌宠在运行
        if self.live2d_process and self.live2d_process.poll() is None:
            self.toast.show_message("桌宠已在运行中，请勿重复启动", 2000)
            return

        self.live2d_process = subprocess.Popen(
            ".\\node\\node.exe .\\node_modules\\electron\\cli.js .",
            shell=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding='utf-8',
            errors='ignore',
            bufsize=1,
            universal_newlines=True
        )

        # 启动线程读取日志
        from threading import Thread
        Thread(target=self.read_logs, daemon=True).start()

        # 检查MCP复选框是否选中，如果选中则启动MCP
        if self.ui.checkBox_mcp.isChecked():
            try:
                self.start_mcp()
            except Exception as e:
                print(f"MCP启动失败: {e}")

    def read_logs(self):
        """读取子进程日志"""
        if not self.live2d_process:
            return

        # 持续读取直到进程结束
        for line in iter(self.live2d_process.stdout.readline, ''):
            if line:
                self.log_signal.emit(line.strip())
            if self.live2d_process.poll() is not None:
                break

        # 读取剩余的错误输出
        if self.live2d_process.stderr:
            for line in iter(self.live2d_process.stderr.readline, ''):
                if line:
                    self.log_signal.emit(f"ERROR: {line.strip()}")
                if self.live2d_process.poll() is not None:
                    break

    def start_mcp(self):
        """启动MCP服务器"""
        try:
            import os
            mcp_path = ".\\server-tools"
            server_file = os.path.join(mcp_path, "server.js")

            # 检查文件是否存在
            if not os.path.exists(server_file):
                print(f"MCP服务器文件不存在: {server_file}")
                return

            self.mcp_process = subprocess.Popen(
                "node server.js",
                shell=True,
                cwd=mcp_path,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                encoding='utf-8',
                errors='ignore'
            )

            # 启动线程读取MCP日志
            from threading import Thread
            Thread(target=self.read_mcp_logs, daemon=True).start()
        except Exception as e:
            print(f"启动MCP进程失败: {e}")

    def read_mcp_logs(self):
        """读取MCP进程日志"""
        if not self.mcp_process:
            return

        try:
            # 持续读取直到进程结束
            for line in iter(self.mcp_process.stdout.readline, ''):
                if line:
                    self.mcp_log_signal.emit(line.strip())
                if self.mcp_process.poll() is not None:
                    break

            # 读取剩余的错误输出
            if self.mcp_process.stderr:
                for line in iter(self.mcp_process.stderr.readline, ''):
                    if line:
                        self.mcp_log_signal.emit(f"ERROR: {line.strip()}")
                    if self.mcp_process.poll() is not None:
                        break
        except Exception as e:
            print(f"读取MCP日志失败: {e}")

    def close_mcp(self):
        """关闭MCP服务器"""
        try:
            if self.mcp_process and self.mcp_process.poll() is None:
                self.mcp_process.terminate()
                self.mcp_process = None
        except Exception as e:
            print(f"关闭MCP进程失败: {e}")

    def close_live_2d(self):
        subprocess.run("taskkill /F /IM node.exe", shell=True)
        # 关闭桌宠时也关闭MCP（如果在运行）
        try:
            if self.mcp_process and self.mcp_process.poll() is None:
                self.close_mcp()
        except Exception as e:
            print(f"关闭MCP失败: {e}")

    def load_config(self):
        with open(self.config_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def save_config(self):
        current_config = self.load_config()

        current_config['llm'] = {
            "api_key": self.ui.lineEdit.text(),
            "api_url": self.ui.lineEdit_2.text(),
            "model": self.ui.lineEdit_3.text(),
            "system_prompt": self.ui.textEdit_3.toPlainText()
        }

        current_config["ui"]["intro_text"] = self.ui.lineEdit_4.text()
        current_config['context']['max_messages'] = int(self.ui.lineEdit_5.text())
        current_config['auto_chat']['interval'] = int(self.ui.lineEdit_interval.text())
        current_config['auto_chat']['idle_time'] = int(self.ui.lineEdit_idle_time.text())

        # 处理房间号
        room_id_text = self.ui.lineEdit_6.text()
        if room_id_text == "你的哔哩哔哩直播间的房间号" or room_id_text == "":
            current_config['bilibili']['roomId'] = 0
        else:
            current_config['bilibili']['roomId'] = int(room_id_text)

        current_config['mcp']['enabled'] = self.ui.checkBox_mcp.isChecked()
        current_config['vision']['auto_screenshot'] = self.ui.checkBox_5.isChecked()
        current_config['ui']['show_chat_box'] = self.ui.checkBox_3.isChecked()
        current_config['context']['enable_limit'] = self.ui.checkBox_4.isChecked()
        current_config['auto_chat']['enabled'] = self.ui.checkBox.isChecked()
        current_config['bilibili']['enabled'] = self.ui.checkBox_2.isChecked()

        with open(self.config_path, 'w', encoding='utf-8') as f:
            json.dump(current_config, f, ensure_ascii=False, indent=2)

        # 使用Toast提示替代QMessageBox
        self.toast.show_message("保存成功", 1500)


if __name__ == '__main__':
    app = QApplication(sys.argv)
    w = set_pyqt()
    w.show()
    sys.exit(app.exec_())