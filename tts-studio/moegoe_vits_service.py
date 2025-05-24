import logging


from .moegoe import utils as utils
def load_vits_model(model_path, config_path):
    global vits_hps, vits_net_g, vits_speakers, vits_n_symbols
    logger.info(f"Loading VITS model from: {model_path}")
    logger.info(f"Loading VITS config from: {config_path}")

    vits_hps = utils.get_hparams_from_file(config_path) # utils 和 commons 需要能被 api.py 导入
    vits_n_symbols = len(vits_hps.symbols) if 'symbols' in vits_hps.keys() else 0
    n_speakers_vits = vits_hps.data.n_speakers if 'n_speakers' in vits_hps.data.keys() else 0
    vits_speakers = vits_hps.speakers if 'speakers' in vits_hps.keys() else ['0'] # 与 MoeGoe.py 保持一致
    emotion_embedding_vits = vits_hps.data.emotion_embedding if 'emotion_embedding' in vits_hps.data.keys() else False


    # 确保 SynthesizerTrn 从你的 models.py (VITS/MoeGoe的) 导入
    # 你可能需要调整 sys.path 或者将 VITS/MoeGoe 的 models.py, utils.py, commons.py 等放到 api.py 能找到的路径
    # 或者将这些类/函数直接复制或整合到 api.py 或其辅助模块中
    from .moegoe.models import SynthesizerTrn as VitsSynthesizerTrn # 重命名以区分GPT-SoVITS的

    vits_net_g = VitsSynthesizerTrn(
        vits_n_symbols,
        vits_hps.data.filter_length // 2 + 1,
        vits_hps.train.segment_size // vits_hps.data.hop_length,
        n_speakers=n_speakers_vits, # 使用从VITS配置中读取的n_speakers
        emotion_embedding=emotion_embedding_vits,
        **vits_hps.model
    )
    _ = vits_net_g.eval()
    if torch.cuda.is_available() and device != "cpu": # 根据全局 device 设置
        vits_net_g = vits_net_g.to(device)
        if is_half: # 根据全局 is_half 设置
            vits_net_g = vits_net_g.half()

    utils.load_checkpoint(model_path, vits_net_g, None) # utils 也需要是 VITS/MoeGoe 的
    logger.info("VITS model loaded successfully.")

# 在 api.py 中
# 确保 get_text 来自 VITS/MoeGoe 的 text.py
from .moegoe.text import text_to_sequence as vits_text_to_sequence # 假设这是VITS的
from .moegoe.text import _clean_text as vits_clean_text     # 假设这是VITS的
from .moegoe import commons
from torch import LongTensor

def vits_get_text(text, hps, cleaned=False): # 从 MoeGoe.py 移植并适配
    # 注意：这里的 hps 是 vits_hps
    if cleaned:
        text_norm = vits_text_to_sequence(text, hps.symbols, [])
    else:
        text_norm = vits_text_to_sequence(text, hps.symbols, hps.data.text_cleaners)
    if hps.data.add_blank:
        # text_norm = vits_intersperse(text_norm, 0) # 确保 vits_intersperse 可用
        text_norm = commons.intersperse(text_norm, 0) # 如果 commons 是共享的或VITS的
    text_norm = LongTensor(text_norm)
    return text_norm

async def get_vits_tts_wav(
    text: str,
    text_language: str, # MoeGoe 可能不需要这个，因为它通过 [JA]/[ZH] 等标记
    speaker_id: int = 0,
    length_scale: float = 1.0,
    noise_scale: float = 0.667,
    noise_scale_w: float = 0.8,
    # ... 其他 VITS/MoeGoe 特有的参数 ...
    # emotion_embedding_path: str = None # 如果支持情感
):
    global vits_hps, vits_net_g, vits_speakers, device, is_half

    if vits_net_g is None or vits_hps is None:
        raise HTTPException(status_code=503, detail="VITS Model not loaded.")

    # 文本预处理 (从 MoeGoe.py 移植)
    # MoeGoe 的文本格式是类似 "[JA]こんにちは[JA]"
    # 你需要确定 API 如何接收这个语言标记，或者在函数内部处理
    # 假设 text 已经是带标记的了，例如 "[ZH]你好[ZH]"
    cleaned = "[CLEANED]" in text # 简单示例，实际处理可能更复杂
    if cleaned:
        text = text.replace("[CLEANED]", "")
    
    # 提取真正的文本和语言标记，MoeGoe的get_text不直接处理[JA]等标记
    # 它的text_to_sequence是基于hps.symbols的
    # MoeGoe的语言标记是在文本外部由用户指定的，或者嵌入文本中但不直接给text_to_sequence
    # VITS模型通常是单语言或通过说话人ID隐式区分语言（如果一个ID只对应一种语言）
    # 如果你的VITS模型支持[JA]这样的内联标记，你需要确保vits_get_text能处理
    # 假设我们直接用传入的文本，并且其内部的[JA]等标记被模型内部 TextEncoder 处理
    # 或者，更简单的是，假设VITS模型是单语言的，或者语言由speaker_id决定
    # 这里我们先简化，假设文本已经是模型可以直接处理的格式

    # 示例：如果你的VITS模型就是MoeGoe那种期望用[JA]包裹的
    # 并且其text_to_sequence能处理这种标记（这不常见，通常标记是给更上层的逻辑）
    # 或者，你需要在API层面解析这个标记，并将其转换为相应的音素或配置

    # 为了简单起见，我们假设 vits_get_text 知道如何处理传入的 text
    # 并且 speaker_id 已经对应了正确的语言（如果模型是多语言的）
    
    # 查找 speakers 列表以确保 speaker_id 有效
    if speaker_id < 0 or speaker_id >= len(vits_speakers):
         raise HTTPException(status_code=400, detail=f"Invalid VITS Speaker ID: {speaker_id}. Available IDs: 0 to {len(vits_speakers)-1}")

    stn_tst = vits_get_text(text, vits_hps, cleaned=cleaned)

    # 推理
    audio_opt_bytes = BytesIO()
    try:
        with torch.no_grad():
            x_tst = stn_tst.unsqueeze(0).to(device)
            x_tst_lengths = LongTensor([stn_tst.size(0)]).to(device)
            sid_tensor = LongTensor([speaker_id]).to(device)

            # 处理 emotion_embedding (如果你的 VITS 模型支持且 API 提供了)
            current_emotion_embedding = None
            # if emotion_embedding_path and getattr(vits_hps.data, 'emotion_embedding', False):
            #     # 这里需要加载 emotion_embedding_path 的逻辑
            #     # 示例： emotion = np.load(emotion_embedding_path)
            #     # current_emotion_embedding = FloatTensor(emotion).unsqueeze(0).to(device)
            #     pass


            audio_numpy = vits_net_g.infer(
                x_tst,
                x_tst_lengths,
                sid=sid_tensor,
                noise_scale=noise_scale,
                noise_scale_w=noise_scale_w,
                length_scale=length_scale,
                emotion_embedding=current_emotion_embedding # 传递情感嵌入
            )[0][0, 0].data.cpu().float().numpy()

        # 使用GPT-SoVITS的音频打包逻辑 (或MoeGoe的，如果不同)
        # GPT-SoVITS的pack_audio是全局的，可以直接用
        audio_opt_bytes = pack_audio(audio_opt_bytes, (audio_numpy * 32768).astype(np.int16), vits_hps.data.sampling_rate)

        # 根据 stream_mode 返回
        # GPT-SoVITS的stream_mode和media_type是全局变量
        if not stream_mode == "normal":
            if media_type == "wav":
                audio_opt_bytes = pack_wav(audio_opt_bytes, vits_hps.data.sampling_rate)
            yield audio_opt_bytes.getvalue()
        else: # 流式，但VITS通常一次性生成，所以这里可能只是返回整个块
              # 真正的流式TTS需要模型本身支持流式解码
            _ , audio_chunk = read_clean_buffer(audio_opt_bytes)
            yield audio_chunk

    except Exception as e:
        logger.error(f"VITS TTS error: {e}", exc_info=True)
        # FastAPI 的 StreamingResponse 不能很好地处理生成器内部的 HTTPException
        # 所以这里我们可能需要一种不同的方式来传递错误
        # 一种简单的方式是让生成器在出错时 yield 一个特殊的错误标记或空的bytes
        # 然后在 FastAPI 端点处检查
        # 或者，如果不是流式，可以直接 raise HTTPException
        if not stream_mode == "normal":
            raise HTTPException(status_code=500, detail=f"VITS TTS generation failed: {str(e)}")
        else:
            yield b'' # 表示错误或结束