#!/usr/bin/env python3
# -*- coding: utf-8 -*-

# 导入所有标签页，使它们可以从tabs包中直接导入
from tabs.base_tab import BaseTab
from tabs.system_tabs import LLMTab, TTSTab, ASRTab
from tabs.feature_tabs import MemoryTab, VisionTab, UITab, ContextTab  # 移除MCPTab
from tabs.social_tabs import BilibiliTab, AutoChatTab
from tabs.launch_tab import LaunchTab  # 导入启动标签页

# 导出所有标签页类
__all__ = [
    'BaseTab',
    'LLMTab', 'TTSTab', 'ASRTab',
    'MemoryTab', 'VisionTab', 'UITab', 'ContextTab',
    'BilibiliTab', 'AutoChatTab', 'LaunchTab'
]