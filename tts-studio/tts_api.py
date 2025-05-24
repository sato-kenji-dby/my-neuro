"""
# api.py usage

` python api.py -dr "123.wav" -dt "一二三。" -dl "zh" `

## 执行参数:

`-s` - `SoVITS模型路径, 可在 config.py 中指定`
`-g` - `GPT模型路径, 可在 config.py 中指定`

调用请求缺少参考音频时使用
`-dr` - `默认参考音频路径`
`-dt` - `默认参考音频文本`
`-dl` - `默认参考音频语种, "中文","英文","日文","韩文","粤语,"zh","en","ja","ko","yue"`

`-d` - `推理设备, "cuda","cpu"`
`-a` - `绑定地址, 默认"127.0.0.1"`
`-p` - `绑定端口, 默认9880, 可在 config.py 中指定`
`-fp` - `覆盖 config.py 使用全精度`
`-hp` - `覆盖 config.py 使用半精度`
`-sm` - `流式返回模式, 默认不启用, "close","c", "normal","n", "keepalive","k"`
·-mt` - `返回的音频编码格式, 流式默认ogg, 非流式默认wav, "wav", "ogg", "aac"`
·-cp` - `文本切分符号设定, 默认为空, 以",.，。"字符串的方式传入`

`-hb` - `cnhubert路径`
`-b` - `bert路径`

## 调用:

### 推理

endpoint: `/`

使用执行参数指定的参考音频:
GET:
    `http://127.0.0.1:9880?text=先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也。&text_language=zh`
POST:
```json
{
    "text": "先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也。",
    "text_language": "zh"
}
```

使用执行参数指定的参考音频并设定分割符号:
GET:
    `http://127.0.0.1:9880?text=先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也。&text_language=zh&cut_punc=，。`
POST:
```json
{
    "text": "先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也。",
    "text_language": "zh",
    "cut_punc": "，。",
}
```

手动指定当次推理所使用的参考音频:
GET:
    `http://127.0.0.1:9880?refer_wav_path=123.wav&prompt_text=一二三。&prompt_language=zh&text=先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也。&text_language=zh`
POST:
```json
{
    "refer_wav_path": "123.wav",
    "prompt_text": "一二三。",
    "prompt_language": "zh",
    "text": "先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也。",
    "text_language": "zh"
}
```

RESP:
成功: 直接返回 wav 音频流， http code 200
失败: 返回包含错误信息的 json, http code 400

手动指定当次推理所使用的参考音频，并提供参数:
GET:
    `http://127.0.0.1:9880?refer_wav_path=123.wav&prompt_text=一二三。&prompt_language=zh&text=先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也。&text_language=zh&top_k=20&top_p=0.6&temperature=0.6&speed=1`
POST:
```json
{
    "refer_wav_path": "123.wav",
    "prompt_text": "一二三。",
    "prompt_language": "zh",
    "text": "先帝创业未半而中道崩殂，今天下三分，益州疲弊，此诚危急存亡之秋也。",
    "text_language": "zh",
    "top_k": 20,
    "top_p": 0.6,
    "temperature": 0.6,
    "speed": 1
}
```

RESP:
成功: 直接返回 wav 音频流， http code 200
失败: 返回包含错误信息的 json, http code 400


### 更换默认参考音频

endpoint: `/change_refer`

key与推理端一样

GET:
    `http://127.0.0.1:9880/change_refer?refer_wav_path=123.wav&prompt_text=一二三。&prompt_language=zh`
POST:
```json
{
    "refer_wav_path": "123.wav",
    "prompt_text": "一二三。",
    "prompt_language": "zh"
}
```

RESP:
成功: json, http code 200
失败: json, 400


### 命令控制

endpoint: `/control`

command:
"restart": 重新运行
"exit": 结束运行

GET:
    `http://127.0.0.1:9880/control?command=restart`
POST:
```json
{
    "command": "restart"
}
```

RESP: 无

"""


import argparse
import os,re
import sys

now_dir = os.getcwd()
sys.path.append(now_dir)
sys.path.append("%s/GPT_SoVITS" % (now_dir))

import signal
from vendor.LangSegment import LangSegment
from time import time as ttime
from fastapi.middleware.cors import CORSMiddleware
import torch
import librosa
import soundfile as sf
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
import uvicorn
from transformers import AutoModelForMaskedLM, AutoTokenizer
import numpy as np
from feature_extractor import cnhubert
from io import BytesIO
from module.models import SynthesizerTrn
from AR.models.t2s_lightning_module import Text2SemanticLightningModule
from text import cleaned_text_to_sequence
from text.cleaner import clean_text
from module.mel_processing import spectrogram_torch
from tools.my_utils import load_audio
import config as global_config
import logging
import subprocess
import json


class DefaultRefer:
    def __init__(self, path, text, language):
        self.path = args.default_refer_path
        self.text = args.default_refer_text
        self.language = args.default_refer_language

    def is_ready(self) -> bool:
        return is_full(self.path, self.text, self.language)


def is_empty(*items):  # 任意一项不为空返回False
    for item in items:
        if item is not None and item != "":
            return False
    return True


def is_full(*items):  # 任意一项为空返回False
    for item in items:
        if item is None or item == "":
            return False
    return True


def change_sovits_weights(sovits_path):
    global vq_model, hps
    dict_s2 = torch.load(sovits_path, map_location="cpu", weights_only=False)
    hps = dict_s2["config"]
    hps = DictToAttrRecursive(hps)
    hps.model.semantic_frame_rate = "25hz"
    if dict_s2['weight']['enc_p.text_embedding.weight'].shape[0] == 322:
        hps.model.version = "v1"
    else:
        hps.model.version = "v2"
    print("sovits版本:",hps.model.version)
    model_params_dict = vars(hps.model)
    vq_model = SynthesizerTrn(
        hps.data.filter_length // 2 + 1,
        hps.train.segment_size // hps.data.hop_length,
        n_speakers=hps.data.n_speakers,
        **model_params_dict
    )
    if ("pretrained" not in sovits_path):
        del vq_model.enc_q
    if is_half == True:
        vq_model = vq_model.half().to(device)
    else:
        vq_model = vq_model.to(device)
    vq_model.eval()
    vq_model.load_state_dict(dict_s2["weight"], strict=False)


def change_gpt_weights(gpt_path):
    global hz, max_sec, t2s_model, config
    hz = 50
    dict_s1 = torch.load(gpt_path, map_location="cpu")
    config = dict_s1["config"]
    max_sec = config["data"]["max_sec"]
    t2s_model = Text2SemanticLightningModule(config, "****", is_train=False)
    t2s_model.load_state_dict(dict_s1["weight"])
    if is_half == True:
        t2s_model = t2s_model.half()
    t2s_model = t2s_model.to(device)
    t2s_model.eval()
    total = sum([param.nelement() for param in t2s_model.parameters()])
    logger.info("Number of parameter: %.2fM" % (total / 1e6))


def get_bert_feature(text, word2ph):
    with torch.no_grad():
        inputs = tokenizer(text, return_tensors="pt")
        for i in inputs:
            inputs[i] = inputs[i].to(device)  #####输入是long不用管精度问题，精度随bert_model
        res = bert_model(**inputs, output_hidden_states=True)
        res = torch.cat(res["hidden_states"][-3:-2], -1)[0].cpu()[1:-1]
    assert len(word2ph) == len(text)
    phone_level_feature = []
    for i in range(len(word2ph)):
        repeat_feature = res[i].repeat(word2ph[i], 1)
        phone_level_feature.append(repeat_feature)
    phone_level_feature = torch.cat(phone_level_feature, dim=0)
    # if(is_half==True):phone_level_feature=phone_level_feature.half()
    return phone_level_feature.T


def clean_text_inf(text, language, version):
    phones, word2ph, norm_text = clean_text(text, language, version)
    phones = cleaned_text_to_sequence(phones, version)
    return phones, word2ph, norm_text


def get_bert_inf(phones, word2ph, norm_text, language):
    language=language.replace("all_","")
    if language == "zh":
        bert = get_bert_feature(norm_text, word2ph).to(device)#.to(dtype)
    else:
        bert = torch.zeros(
            (1024, len(phones)),
            dtype=torch.float16 if is_half == True else torch.float32,
        ).to(device)

    return bert

from text import chinese
def get_phones_and_bert(text,language,version):
    if language in {"en", "all_zh", "all_ja", "all_ko", "all_yue"}:
        language = language.replace("all_","")
        if language == "en":
            LangSegment.setfilters(["en"])
            formattext = " ".join(tmp["text"] for tmp in LangSegment.getTexts(text))
        else:
            # 因无法区别中日韩文汉字,以用户输入为准
            formattext = text
        while "  " in formattext:
            formattext = formattext.replace("  ", " ")
        if language == "zh":
            if re.search(r'[A-Za-z]', formattext):
                formattext = re.sub(r'[a-z]', lambda x: x.group(0).upper(), formattext)
                formattext = chinese.text_normalize(formattext)
                return get_phones_and_bert(formattext,"zh",version)
            else:
                phones, word2ph, norm_text = clean_text_inf(formattext, language, version)
                bert = get_bert_feature(norm_text, word2ph).to(device)
        elif language == "yue" and re.search(r'[A-Za-z]', formattext):
                formattext = re.sub(r'[a-z]', lambda x: x.group(0).upper(), formattext)
                formattext = chinese.text_normalize(formattext)
                return get_phones_and_bert(formattext,"yue",version)
        else:
            phones, word2ph, norm_text = clean_text_inf(formattext, language, version)
            bert = torch.zeros(
                (1024, len(phones)),
                dtype=torch.float16 if is_half == True else torch.float32,
            ).to(device)
    elif language in {"zh", "ja", "ko", "yue", "auto", "auto_yue"}:
        textlist=[]
        langlist=[]
        LangSegment.setfilters(["zh","ja","en","ko"])
        if language == "auto":
            for tmp in LangSegment.getTexts(text):
                langlist.append(tmp["lang"])
                textlist.append(tmp["text"])
        elif language == "auto_yue":
            for tmp in LangSegment.getTexts(text):
                if tmp["lang"] == "zh":
                    tmp["lang"] = "yue"
                langlist.append(tmp["lang"])
                textlist.append(tmp["text"])
        else:
            for tmp in LangSegment.getTexts(text):
                if tmp["lang"] == "en":
                    langlist.append(tmp["lang"])
                else:
                    # 因无法区别中日韩文汉字,以用户输入为准
                    langlist.append(language)
                textlist.append(tmp["text"])
        phones_list = []
        bert_list = []
        norm_text_list = []
        for i in range(len(textlist)):
            lang = langlist[i]
            phones, word2ph, norm_text = clean_text_inf(textlist[i], lang, version)
            bert = get_bert_inf(phones, word2ph, norm_text, lang)
            phones_list.append(phones)
            norm_text_list.append(norm_text)
            bert_list.append(bert)
        bert = torch.cat(bert_list, dim=1)
        phones = sum(phones_list, [])
        norm_text = ''.join(norm_text_list)

    return phones,bert.to(torch.float16 if is_half == True else torch.float32),norm_text


class DictToAttrRecursive(dict):
    def __init__(self, input_dict):
        super().__init__(input_dict)
        for key, value in input_dict.items():
            if isinstance(value, dict):
                value = DictToAttrRecursive(value)
            self[key] = value
            setattr(self, key, value)

    def __getattr__(self, item):
        try:
            return self[item]
        except KeyError:
            raise AttributeError(f"Attribute {item} not found")

    def __setattr__(self, key, value):
        if isinstance(value, dict):
            value = DictToAttrRecursive(value)
        super(DictToAttrRecursive, self).__setitem__(key, value)
        super().__setattr__(key, value)

    def __delattr__(self, item):
        try:
            del self[item]
        except KeyError:
            raise AttributeError(f"Attribute {item} not found")


def get_spepc(hps, filename):
    audio = load_audio(filename, int(hps.data.sampling_rate))
    audio = torch.FloatTensor(audio)
    audio_norm = audio
    audio_norm = audio_norm.unsqueeze(0)
    spec = spectrogram_torch(audio_norm, hps.data.filter_length, hps.data.sampling_rate, hps.data.hop_length,
                             hps.data.win_length, center=False)
    return spec


def pack_audio(audio_bytes, data, rate):
    if media_type == "ogg":
        audio_bytes = pack_ogg(audio_bytes, data, rate)
    elif media_type == "aac":
        audio_bytes = pack_aac(audio_bytes, data, rate)
    else:
        # wav无法流式, 先暂存raw
        audio_bytes = pack_raw(audio_bytes, data, rate)

    return audio_bytes


def pack_ogg(audio_bytes, data, rate):
    # Author: AkagawaTsurunaki
    # Issue:
    #   Stack overflow probabilistically occurs
    #   when the function `sf_writef_short` of `libsndfile_64bit.dll` is called
    #   using the Python library `soundfile`
    # Note:
    #   This is an issue related to `libsndfile`, not this project itself.
    #   It happens when you generate a large audio tensor (about 499804 frames in my PC)
    #   and try to convert it to an ogg file.
    # Related:
    #   https://github.com/RVC-Boss/GPT-SoVITS/issues/1199
    #   https://github.com/libsndfile/libsndfile/issues/1023
    #   https://github.com/bastibe/python-soundfile/issues/396
    # Suggestion:
    #   Or split the whole audio data into smaller audio segment to avoid stack overflow?

    def handle_pack_ogg():
        with sf.SoundFile(audio_bytes, mode='w', samplerate=rate, channels=1, format='ogg') as audio_file:
            audio_file.write(data)

    import threading
    # See: https://docs.python.org/3/library/threading.html
    # The stack size of this thread is at least 32768
    # If stack overflow error still occurs, just modify the `stack_size`.
    # stack_size = n * 4096, where n should be a positive integer.
    # Here we chose n = 4096.
    stack_size = 4096 * 4096
    try:
        threading.stack_size(stack_size)
        pack_ogg_thread = threading.Thread(target=handle_pack_ogg)
        pack_ogg_thread.start()
        pack_ogg_thread.join()
    except RuntimeError as e:
        # If changing the thread stack size is unsupported, a RuntimeError is raised.
        print("RuntimeError: {}".format(e))
        print("Changing the thread stack size is unsupported.")
    except ValueError as e:
        # If the specified stack size is invalid, a ValueError is raised and the stack size is unmodified.
        print("ValueError: {}".format(e))
        print("The specified stack size is invalid.")

    return audio_bytes


def pack_raw(audio_bytes, data, rate):
    audio_bytes.write(data.tobytes())

    return audio_bytes


def pack_wav(audio_bytes, rate):
    data = np.frombuffer(audio_bytes.getvalue(),dtype=np.int16)
    wav_bytes = BytesIO()
    sf.write(wav_bytes, data, rate, format='wav')

    return wav_bytes


def pack_aac(audio_bytes, data, rate):
    process = subprocess.Popen([
        'ffmpeg',
        '-f', 's16le',  # 输入16位有符号小端整数PCM
        '-ar', str(rate),  # 设置采样率
        '-ac', '1',  # 单声道
        '-i', 'pipe:0',  # 从管道读取输入
        '-c:a', 'aac',  # 音频编码器为AAC
        '-b:a', '192k',  # 比特率
        '-vn',  # 不包含视频
        '-f', 'adts',  # 输出AAC数据流格式
        'pipe:1'  # 将输出写入管道
    ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, _ = process.communicate(input=data.tobytes())
    audio_bytes.write(out)

    return audio_bytes


def read_clean_buffer(audio_bytes):
    audio_chunk = audio_bytes.getvalue()
    audio_bytes.truncate(0)
    audio_bytes.seek(0)

    return audio_bytes, audio_chunk


def cut_text(text, punc):
    punc_list = [p for p in punc if p in {",", ".", ";", "?", "!", "、", "，", "。", "？", "！", "；", "：", "…"}]
    if len(punc_list) > 0:
        punds = r"[" + "".join(punc_list) + r"]"
        text = text.strip("\n")
        items = re.split(f"({punds})", text)
        mergeitems = ["".join(group) for group in zip(items[::2], items[1::2])]
        # 在句子不存在符号或句尾无符号的时候保证文本完整
        if len(items)%2 == 1:
            mergeitems.append(items[-1])
        text = "\n".join(mergeitems)

    while "\n\n" in text:
        text = text.replace("\n\n", "\n")

    return text


def only_punc(text):
    return not any(t.isalnum() or t.isalpha() for t in text)


def get_tts_wav(ref_wav_path, prompt_text, prompt_language, text, text_language, top_k= 20, top_p = 0.6, temperature = 0.6, speed = 1):
    t0 = ttime()
    prompt_text = prompt_text.strip("\n")
    prompt_language, text = prompt_language, text.strip("\n")
    zero_wav = np.zeros(int(hps.data.sampling_rate * 0.3), dtype=np.float16 if is_half == True else np.float32)
    with torch.no_grad():
        wav16k, sr = librosa.load(ref_wav_path, sr=16000)
        wav16k = torch.from_numpy(wav16k)
        zero_wav_torch = torch.from_numpy(zero_wav)
        if (is_half == True):
            wav16k = wav16k.half().to(device)
            zero_wav_torch = zero_wav_torch.half().to(device)
        else:
            wav16k = wav16k.to(device)
            zero_wav_torch = zero_wav_torch.to(device)
        wav16k = torch.cat([wav16k, zero_wav_torch])
        ssl_content = ssl_model.model(wav16k.unsqueeze(0))["last_hidden_state"].transpose(1, 2)  # .float()
        codes = vq_model.extract_latent(ssl_content)
        prompt_semantic = codes[0, 0]
    t1 = ttime()
    version = vq_model.version
    os.environ['version'] = version
    prompt_language = dict_language[prompt_language.lower()]
    text_language = dict_language[text_language.lower()]
    phones1, bert1, norm_text1 = get_phones_and_bert(prompt_text, prompt_language, version)
    texts = text.split("\n")
    audio_bytes = BytesIO()

    for text in texts:
        # 简单防止纯符号引发参考音频泄露
        if only_punc(text):
            continue

        audio_opt = []
        phones2, bert2, norm_text2 = get_phones_and_bert(text, text_language, version)
        bert = torch.cat([bert1, bert2], 1)

        all_phoneme_ids = torch.LongTensor(phones1 + phones2).to(device).unsqueeze(0)
        bert = bert.to(device).unsqueeze(0)
        all_phoneme_len = torch.tensor([all_phoneme_ids.shape[-1]]).to(device)
        prompt = prompt_semantic.unsqueeze(0).to(device)
        t2 = ttime()
        with torch.no_grad():
            # pred_semantic = t2s_model.model.infer(
            pred_semantic, idx = t2s_model.model.infer_panel(
                all_phoneme_ids,
                all_phoneme_len,
                prompt,
                bert,
                # prompt_phone_len=ph_offset,
                top_k = top_k,
                top_p = top_p,
                temperature = temperature,
                early_stop_num=hz * max_sec)
        t3 = ttime()
        # print(pred_semantic.shape,idx)
        pred_semantic = pred_semantic[:, -idx:].unsqueeze(0)  # .unsqueeze(0)#mq要多unsqueeze一次
        refer = get_spepc(hps, ref_wav_path)  # .to(device)
        if (is_half == True):
            refer = refer.half().to(device)
        else:
            refer = refer.to(device)
        # audio = vq_model.decode(pred_semantic, all_phoneme_ids, refer).detach().cpu().numpy()[0, 0]
        audio = \
            vq_model.decode(pred_semantic, torch.LongTensor(phones2).to(device).unsqueeze(0),
                            refer,speed=speed).detach().cpu().numpy()[
                0, 0]  ###试试重建不带上prompt部分
        audio_opt.append(audio)
        audio_opt.append(zero_wav)
        t4 = ttime()
        audio_bytes = pack_audio(audio_bytes,(np.concatenate(audio_opt, 0) * 32768).astype(np.int16),hps.data.sampling_rate)
    # logger.info("%.3f\t%.3f\t%.3f\t%.3f" % (t1 - t0, t2 - t1, t3 - t2, t4 - t3))
        if stream_mode == "normal":
            audio_bytes, audio_chunk = read_clean_buffer(audio_bytes)
            yield audio_chunk
    
    if not stream_mode == "normal": 
        if media_type == "wav":
            audio_bytes = pack_wav(audio_bytes,hps.data.sampling_rate)
        yield audio_bytes.getvalue()



def handle_control(command):
    if command == "restart":
        os.execl(g_config.python_exec, g_config.python_exec, *sys.argv)
    elif command == "exit":
        os.kill(os.getpid(), signal.SIGTERM)
        exit(0)


def handle_change(path, text, language):
    if is_empty(path, text, language):
        return JSONResponse({"code": 400, "message": '缺少任意一项以下参数: "path", "text", "language"'}, status_code=400)

    if path != "" or path is not None:
        default_refer.path = path
    if text != "" or text is not None:
        default_refer.text = text
    if language != "" or language is not None:
        default_refer.language = language

    logger.info(f"当前默认参考音频路径: {default_refer.path}")
    logger.info(f"当前默认参考音频文本: {default_refer.text}")
    logger.info(f"当前默认参考音频语种: {default_refer.language}")
    logger.info(f"is_ready: {default_refer.is_ready()}")


    return JSONResponse({"code": 0, "message": "Success"}, status_code=200)


def handle(refer_wav_path, prompt_text, prompt_language, text, text_language, cut_punc, top_k, top_p, temperature, speed):
    if (
            refer_wav_path == "" or refer_wav_path is None
            or prompt_text == "" or prompt_text is None
            or prompt_language == "" or prompt_language is None
    ):
        refer_wav_path, prompt_text, prompt_language = (
            default_refer.path,
            default_refer.text,
            default_refer.language,
        )
        if not default_refer.is_ready():
            return JSONResponse({"code": 400, "message": "未指定参考音频且接口无预设"}, status_code=400)

    if cut_punc == None:
        text = cut_text(text,default_cut_punc)
    else:
        text = cut_text(text,cut_punc)

    return StreamingResponse(get_tts_wav(refer_wav_path, prompt_text, prompt_language, text, text_language, top_k, top_p, temperature, speed), media_type="audio/"+media_type)




# --------------------------------
# 初始化部分
# --------------------------------
dict_language = {
    "中文": "all_zh",
    "粤语": "all_yue",
    "英文": "en",
    "日文": "all_ja",
    "韩文": "all_ko",
    "中英混合": "zh",
    "粤英混合": "yue",
    "日英混合": "ja",
    "韩英混合": "ko",
    "多语种混合": "auto",    #多语种启动切分识别语种
    "多语种混合(粤语)": "auto_yue",
    "all_zh": "all_zh",
    "all_yue": "all_yue",
    "en": "en",
    "all_ja": "all_ja",
    "all_ko": "all_ko",
    "zh": "zh",
    "yue": "yue",
    "ja": "ja",
    "ko": "ko",
    "auto": "auto",
    "auto_yue": "auto_yue",
}

# logger
logging.config.dictConfig(uvicorn.config.LOGGING_CONFIG)
logger = logging.getLogger('uvicorn')

# 获取配置
g_config = global_config.Config()

# 获取参数
parser = argparse.ArgumentParser(description="GPT-SoVITS api")

parser.add_argument("-s", "--sovits_path", type=str, default=g_config.sovits_path, help="SoVITS模型路径")
parser.add_argument("-g", "--gpt_path", type=str, default=g_config.gpt_path, help="GPT模型路径")
parser.add_argument("-dr", "--default_refer_path", type=str, default="", help="默认参考音频路径")
parser.add_argument("-dt", "--default_refer_text", type=str, default="", help="默认参考音频文本")
parser.add_argument("-dl", "--default_refer_language", type=str, default="", help="默认参考音频语种")
parser.add_argument("-d", "--device", type=str, default=g_config.infer_device, help="cuda / cpu")
parser.add_argument("-a", "--bind_addr", type=str, default="0.0.0.0", help="default: 0.0.0.0")
parser.add_argument("-p", "--port", type=int, default=g_config.api_port, help="default: 9880")
parser.add_argument("-fp", "--full_precision", action="store_true", default=False, help="覆盖config.is_half为False, 使用全精度")
parser.add_argument("-hp", "--half_precision", action="store_true", default=False, help="覆盖config.is_half为True, 使用半精度")
# bool值的用法为 `python ./api.py -fp ...`
# 此时 full_precision==True, half_precision==False
parser.add_argument("-sm", "--stream_mode", type=str, default="close", help="流式返回模式, close / normal / keepalive")
parser.add_argument("-mt", "--media_type", type=str, default="wav", help="音频编码格式, wav / ogg / aac")
parser.add_argument("-cp", "--cut_punc", type=str, default="", help="文本切分符号设定, 符号范围,.;?!、，。？！；：…")
# 切割常用分句符为 `python ./api.py -cp ".?!。？！"`
parser.add_argument("-hb", "--hubert_path", type=str, default=g_config.cnhubert_path, help="覆盖config.cnhubert_path")
parser.add_argument("-b", "--bert_path", type=str, default=g_config.bert_path, help="覆盖config.bert_path")

args = parser.parse_args()
sovits_path = args.sovits_path
gpt_path = args.gpt_path
device = args.device
port = args.port
host = args.bind_addr
cnhubert_base_path = args.hubert_path
bert_path = args.bert_path
default_cut_punc = args.cut_punc

# 应用参数配置
default_refer = DefaultRefer(args.default_refer_path, args.default_refer_text, args.default_refer_language)

# 模型路径检查
if sovits_path == "":
    sovits_path = g_config.pretrained_sovits_path
    logger.warn(f"未指定SoVITS模型路径, fallback后当前值: {sovits_path}")
if gpt_path == "":
    gpt_path = g_config.pretrained_gpt_path
    logger.warn(f"未指定GPT模型路径, fallback后当前值: {gpt_path}")

# 指定默认参考音频, 调用方 未提供/未给全 参考音频参数时使用
if default_refer.path == "" or default_refer.text == "" or default_refer.language == "":
    default_refer.path, default_refer.text, default_refer.language = "", "", ""
    logger.info("未指定默认参考音频")
else:
    logger.info(f"默认参考音频路径: {default_refer.path}")
    logger.info(f"默认参考音频文本: {default_refer.text}")
    logger.info(f"默认参考音频语种: {default_refer.language}")

# 获取半精度
is_half = g_config.is_half
if args.full_precision:
    is_half = False
if args.half_precision:
    is_half = True
if args.full_precision and args.half_precision:
    is_half = g_config.is_half  # 炒饭fallback
logger.info(f"半精: {is_half}")

# 流式返回模式
if args.stream_mode.lower() in ["normal","n"]:
    stream_mode = "normal"
    logger.info("流式返回已开启")
else:
    stream_mode = "close"

# 音频编码格式
if args.media_type.lower() in ["aac","ogg"]:
    media_type = args.media_type.lower()
elif stream_mode == "close":
    media_type = "wav"
else:
    media_type = "ogg"
logger.info(f"编码格式: {media_type}")

# 初始化模型
cnhubert.cnhubert_base_path = cnhubert_base_path
tokenizer = AutoTokenizer.from_pretrained(bert_path)
bert_model = AutoModelForMaskedLM.from_pretrained(bert_path)
ssl_model = cnhubert.get_model()
if is_half:
    bert_model = bert_model.half().to(device)
    ssl_model = ssl_model.half().to(device)
else:
    bert_model = bert_model.to(device)
    ssl_model = ssl_model.to(device)
change_sovits_weights(sovits_path)
change_gpt_weights(gpt_path)




# --------------------------------
# 接口部分
# --------------------------------
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # 可以指定允许访问的源
    allow_credentials=True,
    allow_methods=["*"],  # 允许的请求方法
    allow_headers=["*"],  # 允许的请求头
)

# 添加语音配置文件路径
VOICES_CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "voices_config.json")

# 尝试加载语音配置文件，如果不存在则创建空配置
try:
    with open(VOICES_CONFIG_FILE, 'r', encoding='utf-8') as f:
        voices_config = json.load(f)
except FileNotFoundError:
    voices_config = []
    with open(VOICES_CONFIG_FILE, 'w', encoding='utf-8') as f:
        json.dump(voices_config, f, ensure_ascii=False, indent=4)


@app.get("/voices")
async def get_voices():
    """获取所有可用的语音配置"""
    return voices_config


@app.get("/select_voice/{id}")
async def select_voice_get(id: int):
    """通过ID选择语音 (GET方式)"""
    if id < 0 or id >= len(voices_config):
        return JSONResponse({"code": 400, "message": "无效的语音ID"}, status_code=400)

    voice = voices_config[id]
    return handle_change(voice.get("path"), voice.get("text"), voice.get("language"))


@app.post("/set_model")
async def set_model(request: Request):
    json_post_raw = await request.json()
    global gpt_path
    gpt_path=json_post_raw.get("gpt_model_path")
    global sovits_path
    sovits_path=json_post_raw.get("sovits_model_path")
    logger.info("gptpath"+gpt_path+";vitspath"+sovits_path)
    change_sovits_weights(sovits_path)
    change_gpt_weights(gpt_path)
    return "ok"


@app.post("/control")
async def control(request: Request):
    json_post_raw = await request.json()
    return handle_control(json_post_raw.get("command"))


@app.get("/control")
async def control(command: str = None):
    return handle_control(command)


@app.post("/change_refer")
async def change_refer(request: Request):
    json_post_raw = await request.json()
    return handle_change(
        json_post_raw.get("refer_wav_path"),
        json_post_raw.get("prompt_text"),
        json_post_raw.get("prompt_language")
    )


@app.get("/change_refer")
async def change_refer(
        refer_wav_path: str = None,
        prompt_text: str = None,
        prompt_language: str = None
):
    return handle_change(refer_wav_path, prompt_text, prompt_language)


@app.post("/")
async def tts_endpoint(request: Request):
    json_post_raw = await request.json()
    return handle(
        json_post_raw.get("refer_wav_path"),
        json_post_raw.get("prompt_text"),
        json_post_raw.get("prompt_language"),
        json_post_raw.get("text"),
        json_post_raw.get("text_language"),
        json_post_raw.get("cut_punc"),
        json_post_raw.get("top_k", 10),
        json_post_raw.get("top_p", 1.0),
        json_post_raw.get("temperature", 1.0),
        json_post_raw.get("speed", 1.0)
    )


@app.get("/")
async def tts_endpoint(
        refer_wav_path: str = None,
        prompt_text: str = None,
        prompt_language: str = None,
        text: str = None,
        text_language: str = None,
        cut_punc: str = None,
        top_k: int = 10,
        top_p: float = 1.0,
        temperature: float = 1.0,
        speed: float = 1.0
):
    return handle(refer_wav_path, prompt_text, prompt_language, text, text_language, cut_punc, top_k, top_p, temperature, speed)


import os
import sys
import logging # 假设 logger 已经在 GPT-SoVITS 的 api.py 中配置好了
import torch
from torch import LongTensor, no_grad
from io import BytesIO
import numpy as np # 确保已安装
import soundfile as sf # 确保已安装，MoeGoe 可能用 scipy.io.wavfile.write
from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse

# --- 假设这些是 api.py 中已有的全局变量或从 argparse/config.py 获取 ---
# now_dir = os.getcwd() # 通常在 api.py 开头
# device = "cuda"  # or "cpu", 从 args.device 获取
# is_half = False # or True, 从 args.is_half 或命令行参数获取
# logger = logging.getLogger('uvicorn') # GPT-SoVITS 的 logger
# stream_mode = "close" # or "normal", 从 args.stream_mode 获取
# media_type = "wav" # or "ogg", "aac", 从 args.media_type 获取
# g_config = global_config.Config() # 假设 GPT-SoVITS 的全局配置对象

# --- VITS/MoeGoe Submodule 导入 ---
# 确保 moegoe submodule 在 Python 的搜索路径中
# 如果 api.py 和 moegoe 文件夹在同一级，并且 moegoe 是一个包 (有 __init__.py)
# 或者你需要根据你的项目结构调整
# sys.path.append(os.path.join(now_dir, "moegoe")) # 一种可能的处理方式，如果直接 from .moegoe 不工作

try:
    from .moegoe import utils as vits_utils
    from .moegoe.models import SynthesizerTrn as VitsSynthesizerTrn
    from .moegoe.text import text_to_sequence as vits_text_to_sequence
    from .moegoe.text import _clean_text as vits_clean_text # 如果需要
    from .moegoe import commons as vits_commons
    # 如果 MoeGoe 使用 scipy.io.wavfile, 你可能需要它，或者用 soundfile 替代
    # from scipy.io.wavfile import write as vits_write_wav
except ImportError as e:
    sys.path.append(os.path.join(now_dir, "moegoe"))
    from moegoe import utils as vits_utils
    from moegoe.models import SynthesizerTrn as VitsSynthesizerTrn
    from moegoe.text import text_to_sequence as vits_text_to_sequence
    from moegoe.text import _clean_text as vits_clean_text # 如果需要
    from moegoe import commons as vits_commons
    logger.error(f"Failed to import MoeGoe submodule components. Ensure 'moegoe' is a valid submodule/package in the path: {e}")
    # 你可以在这里决定是否因为导入失败而退出程序
    # sys.exit(1)
    # 为了示例继续，我们假设导入成功，但在实际应用中需要处理这个错误

# --- VITS/MoeGoe 全局状态 ---
vits_hps_global = None
vits_net_g_global = None
vits_speakers_global = None # 通常是一个列表或字典
vits_n_symbols_global = 0

# --- VITS/MoeGoe 核心函数 ---
def load_vits_model(model_path: str, config_path: str):
    """加载 VITS/MoeGoe 模型和配置"""
    global vits_hps_global, vits_net_g_global, vits_speakers_global, vits_n_symbols_global, device, is_half, logger

    if not os.path.exists(model_path):
        logger.error(f"VITS model file not found: {model_path}")
        raise FileNotFoundError(f"VITS model file not found: {model_path}")
    if not os.path.exists(config_path):
        logger.error(f"VITS config file not found: {config_path}")
        raise FileNotFoundError(f"VITS config file not found: {config_path}")

    logger.info(f"Loading VITS model from: {model_path}")
    logger.info(f"Loading VITS config from: {config_path}")

    try:
        vits_hps_global = vits_utils.get_hparams_from_file(config_path)
        vits_n_symbols_global = len(vits_hps_global.symbols) if hasattr(vits_hps_global, 'symbols') else 0
        n_speakers_vits = getattr(vits_hps_global.data, 'n_speakers', 0) # 使用 getattr 更安全
        vits_speakers_global = getattr(vits_hps_global, 'speakers', ['0']) # 可能是列表或字典
        emotion_embedding_vits = getattr(vits_hps_global.data, 'emotion_embedding', False)

        vits_net_g_global = VitsSynthesizerTrn(
            vits_n_symbols_global,
            vits_hps_global.data.filter_length // 2 + 1,
            vits_hps_global.train.segment_size // vits_hps_global.data.hop_length,
            n_speakers=n_speakers_vits,
            emotion_embedding=emotion_embedding_vits,
            **vits_hps_global.model  # 将模型参数解包传入
        )
        _ = vits_net_g_global.eval()

        if torch.cuda.is_available() and device.lower() == "cuda":
            vits_net_g_global = vits_net_g_global.to("cuda")
            if is_half:
                vits_net_g_global = vits_net_g_global.half()
        else:
            vits_net_g_global = vits_net_g_global.to("cpu")


        vits_utils.load_checkpoint(model_path, vits_net_g_global)
        logger.info("VITS model loaded successfully.")

    except Exception as e:
        logger.error(f"Error loading VITS model: {e}", exc_info=True)
        vits_net_g_global = None # 确保加载失败时模型为空
        raise  # 重新抛出异常，让调用者知道

def vits_get_text_internal(text: str, hps, cleaned: bool = False):
    """
    内部文本处理函数，将文本转换为 VITS 模型所需的音素序列ID。
    这里的 hps 是 VITS 的配置对象 (vits_hps_global)。
    """
    if cleaned:
        text_norm = vits_text_to_sequence(text, hps.symbols, [])
    else:
        text_norm = vits_text_to_sequence(text, hps.symbols, hps.data.text_cleaners)

    if getattr(hps.data, 'add_blank', False):
        text_norm = vits_commons.intersperse(text_norm, 0)
    text_norm = LongTensor(text_norm)
    return text_norm

async def get_vits_tts_audio_stream(
    text: str,
    language_code: str,
    speaker_id: int = 0,
    length_scale: float = 1.0,
    noise_scale: float = 0.667,
    noise_scale_w: float = 0.8,
    # cleaned_flag: bool = False, # 假设从 text 中解析 [CLEANED]
    # emotion_embedding_tensor: torch.Tensor = None # 如果支持并传递
):
    """
    VITS TTS 核心推理逻辑，作为异步生成器返回音频块。
    """
    global vits_hps_global, vits_net_g_global, vits_speakers_global, device, is_half, logger, stream_mode, media_type

    if vits_net_g_global is None or vits_hps_global is None:
        logger.error("VITS Model not loaded. Cannot perform TTS.")
        yield b'ERROR:VITS Model not loaded.'
        return

    # 1. 文本预处理和语言标记解析 (关键部分)
    text = f"[{language_code}]{text}[{language_code}]"
    print(text)
    cleaned_flag = "[CLEANED]" in text # 你仍然可以保留这个标记，如果需要
    if cleaned_flag:
        processed_text = text.replace("[CLEANED]", "")
    else:
        processed_text = text

    if not processed_text.strip():
        logger.error("Processed text for VITS is empty.")
        yield b'ERROR:Processed text is empty.'
        return

    # 2. 检查 Speaker ID
    actual_n_speakers = getattr(vits_hps_global.data, 'n_speakers', 0)
    if not (0 <= speaker_id < actual_n_speakers):
        logger.error(f"Invalid VITS Speaker ID: {speaker_id}. Expected 0 to {actual_n_speakers - 1}.")
        yield b'ERROR:Invalid VITS Speaker ID.'
        return

    # 3. 将文本转换为音素序列
    try:
        # 注意：这里传入的 `processed_text` 应该是纯净的、该语言的文本
        # `vits_hps_global` 应该包含对应语言的 `symbols` 和 `text_cleaners`
        stn_tst = vits_get_text_internal(processed_text, vits_hps_global, cleaned=cleaned_flag)
    except Exception as e:
        logger.error(f"Error during VITS text processing: {e}", exc_info=True)
        yield b'ERROR:VITS text processing failed.'
        return

    # 4. 执行推理
    audio_output_buffer = BytesIO() # 用于收集所有音频块（如果非流式）或当前块
    try:
        with no_grad(): # 确保在推理模式下
            x_tst = stn_tst.unsqueeze(0).to(device)
            x_tst_lengths = LongTensor([stn_tst.size(0)]).to(device)
            sid_tensor = LongTensor([speaker_id]).to(device)
            current_emotion_embedding = None # 实现情感嵌入加载逻辑（如果需要）

            # 调用 VITS 模型的 infer 方法
            # 注意：确保你的 VitsSynthesizerTrn.infer 方法返回的是 (audio_numpy_array, ...)
            # 并且第一个元素是音频数据
            # MoeGoe的infer返回 `o, attn, y_mask, (z, z_p, m_p, logs_p)`
            # 我们需要 o[0][0,0].data.cpu().float().numpy()
            inference_output = vits_net_g_global.infer(
                x_tst,
                x_tst_lengths,
                sid=sid_tensor,
                noise_scale=noise_scale,
                noise_scale_w=noise_scale_w,
                length_scale=length_scale,
                emotion_embedding=current_emotion_embedding # 传递情感嵌入
            )
            audio_numpy = inference_output[0][0, 0].data.cpu().float().numpy()

        # 5. 音频打包和流式处理
        # 使用 GPT-SoVITS 的 pack_audio, pack_wav (全局函数)
        # 注意：pack_audio 和 pack_wav 是从 GPT-SoVITS 的 api.py 来的，需要确保它们在作用域内
        # 我们假设它们是全局可用的
        audio_data_int16 = (audio_numpy * 32768).astype(np.int16)
        current_sampling_rate = vits_hps_global.data.sampling_rate

        # MoeGoe/VITS 通常一次性生成整个音频，所以“流式”在这里主要是指
        # 服务器可以分块发送已生成的完整音频，而不是边生成边发送小片段。
        # 如果你想实现真正的逐句流式，需要在 get_vits_tts_audio_stream 外层做文本切分和循环调用。
        # 这里我们简化为一次生成并发送。

        if stream_mode == "normal": # 分块发送已生成的音频 (如果音频很大)
            # 对于 'normal' 流式，我们将完整的音频数据打包成目标格式，然后可以分块 yield
            # 但由于 VITS 一次生成，这里简单地一次性 yield
            temp_buffer = BytesIO()
            if media_type == "wav":
                sf.write(temp_buffer, audio_data_int16, current_sampling_rate, format='WAV')
            elif media_type == "ogg":
                sf.write(temp_buffer, audio_data_int16, current_sampling_rate, format='OGG', subtype='VORBIS')
            elif media_type == "aac":
                # 使用 pack_aac (来自GPT-SoVITS api.py)
                process = subprocess.Popen([
                    'ffmpeg', '-f', 's16le', '-ar', str(current_sampling_rate), '-ac', '1', '-i', 'pipe:0',
                    '-c:a', 'aac', '-b:a', '192k', '-vn', '-f', 'adts', 'pipe:1'
                ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                out_aac, _ = process.communicate(input=audio_data_int16.tobytes())
                temp_buffer.write(out_aac)
            else: # 默认为 wav
                 sf.write(temp_buffer, audio_data_int16, current_sampling_rate, format='WAV')
            temp_buffer.seek(0)
            yield temp_buffer.read() # 一次性 yield
        else: # "close" 模式，也是一次性生成和发送
            if media_type == "wav":
                sf.write(audio_output_buffer, audio_data_int16, current_sampling_rate, format='WAV')
            elif media_type == "ogg":
                sf.write(audio_output_buffer, audio_data_int16, current_sampling_rate, format='OGG', subtype='VORBIS')
            elif media_type == "aac":
                process = subprocess.Popen([
                    'ffmpeg', '-f', 's16le', '-ar', str(current_sampling_rate), '-ac', '1', '-i', 'pipe:0',
                    '-c:a', 'aac', '-b:a', '192k', '-vn', '-f', 'adts', 'pipe:1'
                ], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                out_aac, _ = process.communicate(input=audio_data_int16.tobytes())
                audio_output_buffer.write(out_aac)
            else: # 默认为 wav
                sf.write(audio_output_buffer, audio_data_int16, current_sampling_rate, format='WAV')

            audio_output_buffer.seek(0)
            yield audio_output_buffer.getvalue()

    except Exception as e:
        logger.error(f"Error during VITS TTS inference or audio packing: {e}", exc_info=True)
        yield b'ERROR:VITS TTS inference failed.'
        return

# --- FastAPI 端点定义 (VITS/MoeGoe 相关) ---
# 假设 app = FastAPI() 已经在 api.py 中定义

@app.post("/set_vits_model")
async def set_vits_model_endpoint(request: Request):
    """动态设置 VITS 模型和配置文件路径"""
    global logger
    try:
        json_post_raw = await request.json()
        vits_model_path = json_post_raw.get("vits_model_path")
        vits_config_path = json_post_raw.get("vits_config_path")

        if not vits_model_path or not vits_config_path:
            return JSONResponse(
                {"code": 400, "message": "vits_model_path and vits_config_path are required."},
                status_code=400
            )
        # 路径可以是相对 api.py 的，或者绝对路径
        # 为安全起见，最好对路径进行一些校验或限制
        load_vits_model(vits_model_path, vits_config_path)
        return JSONResponse({"code": 0, "message": "VITS model changed successfully."}, status_code=200)
    except FileNotFoundError as fe:
        logger.error(f"File not found when setting VITS model: {fe}")
        return JSONResponse({"code": 404, "message": str(fe)}, status_code=404)
    except Exception as e:
        logger.error(f"Error setting VITS model: {e}", exc_info=True)
        return JSONResponse({"code": 500, "message": f"Failed to set VITS model: {str(e)}"}, status_code=500)

async def _handle_vits_tts_request(
    text: str,
    language_code: str, # 新增参数
    speaker_id: int,
    length_scale: float,
    noise_scale: float,
    noise_scale_w: float
):
    """内部处理函数，用于 GET 和 POST 端点共用逻辑"""
    global logger, media_type, vits_net_g_global

    if not text:
        raise HTTPException(status_code=400, detail="Text is required for VITS TTS")
    if vits_net_g_global is None:
        raise HTTPException(status_code=503, detail="VITS Model not loaded. Use /set_vits_model first.")

    # 创建一个包装生成器来处理可能的错误标记并转换为HTTPException（如果非流式）
    # 或者让客户端处理流中的错误标记
    async def stream_wrapper():
        async for chunk in get_vits_tts_audio_stream(
            text=text,
            language_code=language_code,
            speaker_id=speaker_id,
            length_scale=length_scale,
            noise_scale=noise_scale,
            noise_scale_w=noise_scale_w
        ):
            if isinstance(chunk, bytes) and chunk.startswith(b'ERROR:'):
                error_message = chunk.decode().replace('ERROR:', '')
                logger.error(f"Error from VITS TTS stream: {error_message}")
                # 如果是流式，我们不能抛出HTTPException，因为头可能已经发送
                # 如果不是流式，理论上可以在这里收集所有块，如果检测到错误则抛出
                # 为了简化，我们让客户端处理流中的错误标记或不完整的流
                # 或者，如果 stream_mode == "close"，我们可以在 get_vits_tts_audio_stream 中
                # 不 yield 错误标记，而是直接 raise 一个自定义异常，然后在这里捕获
                raise HTTPException(status_code=500, detail=f"VITS TTS failed: {error_message}")
            yield chunk

    return StreamingResponse(stream_wrapper(), media_type="audio/" + media_type)


@app.post("/vits-tts/")
async def vits_tts_endpoint_post(request: Request):
    global logger
    try:
        json_post_raw = await request.json()
        text = json_post_raw.get("text")
        language_code = json_post_raw.get("language_code", "JA") # 例如 "ja", "zh", "en", "auto"
        speaker_id = int(json_post_raw.get("speaker_id", 0))
        length_scale = float(json_post_raw.get("length_scale", 1.0))
        noise_scale = float(json_post_raw.get("noise_scale", 0.667))
        noise_scale_w = float(json_post_raw.get("noise_scale_w", 0.8))

        if not text:
            return JSONResponse({"code": 400, "message": "Text is required."}, status_code=400)
        
        return await _handle_vits_tts_request(
            text, language_code, speaker_id, length_scale, noise_scale, noise_scale_w
        )
    except ValueError as ve:
        logger.error(f"Invalid parameter value in /vits-tts/ POST: {ve}", exc_info=True)
        return JSONResponse({"code": 400, "message": f"Invalid parameter value: {str(ve)}"}, status_code=400)
    except HTTPException as http_exc: # 捕获由 _handle_vits_tts_request 抛出的
        raise http_exc
    except Exception as e:
        logger.error(f"Unexpected error in /vits-tts/ POST endpoint: {e}", exc_info=True)
        return JSONResponse({"code": 500, "message": f"Internal server error: {str(e)}"}, status_code=500)

@app.get("/vits-tts/")
async def vits_tts_endpoint_get(
        text: str, # FastAPI 会自动从查询参数获取
        language_code: str = "auto",
        speaker_id: int = 0,
        length_scale: float = 1.0,
        noise_scale: float = 0.667,
        noise_scale_w: float = 0.8
):
    """VITS TTS 端点 (GET)"""
    global logger
    try:
        return await _handle_vits_tts_request(
            text, language_code, speaker_id, length_scale, noise_scale, noise_scale_w
        )
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Unexpected error in /vits-tts/ GET endpoint: {e}", exc_info=True)
        return JSONResponse({"code": 500, "message": f"Internal server error: {str(e)}"}, status_code=500)

if __name__ == "__main__":
       # 假设 g_config 已经从 config.py 或命令行参数初始化
    default_vits_model_path_from_config = getattr(g_config, 'vits_model_path', os.path.join(now_dir, "moegoe", "lib", "seraphim.pth"))
    default_vits_config_path_from_config = getattr(g_config, 'vits_config_path', os.path.join(now_dir, "moegoe", "lib", "seraphim.json"))

    if default_vits_model_path_from_config and default_vits_config_path_from_config and \
        os.path.exists(default_vits_model_path_from_config) and \
        os.path.exists(default_vits_config_path_from_config):
        try:
           logger.info("Loading default VITS model on startup...")
           load_vits_model(default_vits_model_path_from_config, default_vits_config_path_from_config)
        except Exception as e:
           logger.error(f"Failed to load default VITS model on startup: {e}", exc_info=True)
    else:
       logger.warning("Default VITS model or config path not found or not specified in config.py. "
                      "Use /set_vits_model API to load a VITS model.")
    uvicorn.run(app, host=host, port=port, workers=1)
