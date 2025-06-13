@echo off
title 启动所有API服务
:: 使用脚本所在目录作为工作目录
cd %~dp0
:: 启动第一个API
start cmd /k "call conda activate my-neuro && python asr_api.py"
timeout /t 3
:: 启动第二个API
@REM start cmd /k "call conda activate my-neuro &&cd tts-studio &&python tts_api.py -p 5000 -d cuda -s tts-model/FKTTS/fake_neuro.pth -dr tts-model/FKTTS/sama.wav -dt "Hold on please, I'm busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday." -dl "en""
start cmd /k "call conda activate my-neuro &&cd tts-studio && python tts_api.py -p 5000 -d cuda -s tts-model/merge.pth -dr tts-model/neuro/01.wav -dt "Hold on please, I'm busy. Okay, I think I heard him say he wants me to stream Hollow Knight on Tuesday and Thursday." -dl "en"
timeout /t 3
:: 启动第三个API (BERT)
start cmd /k "call conda activate my-neuro && python bert_api.py"
timeout /t 3
:: 启动第四个API (Mnemosyne-bert)
start cmd /k "call conda activate my-neuro && python Mnemosyne-bert\api_go.py"
echo 所有API服务已启动!
