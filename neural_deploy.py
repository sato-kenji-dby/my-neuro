import os
import sys
import time
import subprocess
import shutil
import zipfile
import requests
from modelscope import snapshot_download

def display_progress_bar(percent, message="", mb_downloaded=None, mb_total=None, current=None, total=None):
    """显示通用进度条"""
    bar_length = 40
    filled_length = int(bar_length * percent / 100)
    bar = '█' * filled_length + '-' * (bar_length - filled_length)
    
    # 添加下载信息（如果提供）
    extra_info = ""
    if mb_downloaded is not None and mb_total is not None:
        extra_info = f" ({mb_downloaded:.2f}MB/{mb_total:.2f}MB)"
    elif current is not None and total is not None:
        extra_info = f" ({current}/{total}个文件)"
    
    sys.stdout.write(f"\r{message}: |{bar}| {percent}% 完成{extra_info}")
    sys.stdout.flush()

def download_file(url, file_name=None, target_folder=None):
    """下载文件并显示进度条"""
    if file_name is None:
        file_name = url.split('/')[-1]
    
    print(f"正在下载: {file_name}...")
    response = requests.get(url, stream=True)
    
    # 获取文件总大小
    total_size = int(response.headers.get('content-length', 0))
    downloaded_size = 0
    
    # 打开文件准备写入
    with open(file_name, 'wb') as file:
        # 逐块下载
        for chunk in response.iter_content(chunk_size=1024*1024):  # 每次下载1MB
            if chunk:
                file.write(chunk)
                downloaded_size += len(chunk)
                
                # 计算下载百分比
                percent = int(downloaded_size * 100 / total_size) if total_size > 0 else 0
                
                # 计算下载的MB
                mb_downloaded = downloaded_size / (1024 * 1024)
                mb_total = total_size / (1024 * 1024)
                
                # 显示进度条
                display_progress_bar(
                    percent, 
                    "下载进度", 
                    mb_downloaded=mb_downloaded, 
                    mb_total=mb_total
                )
    
    print("\n下载完成!")
    return file_name

def extract_zip(zip_file, target_folder):
    """解压ZIP文件到指定文件夹并显示进度"""
    print(f"正在解压 {zip_file} 到 {target_folder}...")
    
    if not os.path.exists(target_folder):
        os.makedirs(target_folder)
        print(f"已创建目标文件夹: {target_folder}")
    
    try:
        with zipfile.ZipFile(zip_file, 'r') as zip_ref:
            # 获取zip文件中的所有文件列表
            file_list = zip_ref.namelist()
            total_files = len(file_list)
            
            # 逐个解压文件并显示进度
            for index, file in enumerate(file_list):
                # 修复中文文件名编码问题
                try:
                    # 尝试使用CP437解码然后使用GBK/GB2312重新编码
                    correct_filename = file.encode('cp437').decode('gbk')
                    # 创建目标路径
                    target_path = os.path.join(target_folder, correct_filename)
                    
                    # 创建必要的目录
                    if os.path.dirname(target_path) and not os.path.exists(os.path.dirname(target_path)):
                        os.makedirs(os.path.dirname(target_path), exist_ok=True)
                    
                    # 提取文件到目标路径
                    data = zip_ref.read(file)
                    # 如果是目录项则跳过写入文件
                    if not correct_filename.endswith('/'):
                        with open(target_path, 'wb') as f:
                            f.write(data)
                except Exception as e:
                    # 如果编码转换失败，直接使用原始路径
                    # 先提取到临时位置
                    zip_ref.extract(file)
                    
                    # 如果解压成功，移动文件到目标文件夹
                    if os.path.exists(file):
                        target_path = os.path.join(target_folder, file)
                        # 确保目标目录存在
                        if os.path.dirname(target_path) and not os.path.exists(os.path.dirname(target_path)):
                            os.makedirs(os.path.dirname(target_path), exist_ok=True)
                        # 移动文件
                        shutil.move(file, target_path)
                
                # 计算解压百分比
                percent = int((index + 1) * 100 / total_files)
                
                # 显示进度条
                display_progress_bar(
                    percent, 
                    "解压进度", 
                    current=index+1, 
                    total=total_files
                )
        
        print("\n解压完成!")
        print(f"所有文件已解压到 '{target_folder}' 文件夹")
        return True
    
    except zipfile.BadZipFile:
        print("错误: 下载的文件不是有效的ZIP格式")
        return False
    except Exception as e:
        print(f"解压过程中出错: {e}")
        return False

def check_env_exists(env_name):
    """检查conda环境是否已存在"""
    result = subprocess.run("conda env list", shell=True, capture_output=True, text=True)
    return env_name in result.stdout

def run_in_conda_env(command):
    """在指定的conda环境中运行命令"""
    if sys.platform == "win32":
        # Windows
        conda_command = f"call conda activate my-neuro && {command}"
    else:
        # Linux/Mac
        conda_command = f"source $(conda info --base)/etc/profile.d/conda.sh && conda activate my-neuro && {command}"
    
    print(f"执行命令: {conda_command}")
    return subprocess.run(conda_command, shell=True)

def download_with_retry(command, max_retry=3, wait_time=5):
    """执行下载命令，支持重试机制"""
    print(f"执行命令: {command}")
    for attempt in range(max_retry):
        if attempt > 0:
            print(f"第 {attempt+1} 次尝试下载...")
        
        result = subprocess.Popen(
            command,
            shell=True,
            stdout=None,
            stderr=None
        ).wait()
        
        if result == 0:
            print("下载成功!")
            return True
        else:
            print(f"下载失败，返回值: {result}")
            if attempt < max_retry - 1:
                print(f"等待 {wait_time} 秒后重试...")
                time.sleep(wait_time)
    
    print(f"经过 {max_retry} 次尝试后，下载仍然失败")
    return False

def setup_conda_environment():
    """设置conda环境"""
    print("\n========== 检查并创建conda环境 ==========")
    if check_env_exists("my-neuro"):
        print("发现已存在名为 my-neuro 的conda环境。")
        user_choice = input("是否要删除已有环境并重新创建？(y/n): ")
        if user_choice.lower() == 'y':
            print("正在删除已有环境...")
            subprocess.run("conda env remove -n my-neuro -y", shell=True)
            print("创建新的 my-neuro 环境...")
            subprocess.run("conda create -n my-neuro python=3.11 -y", shell=True, check=True)
        else:
            print("保留现有环境，继续安装过程...")
    else:
        print("创建 my-neuro 环境...")
        subprocess.run("conda create -n my-neuro python=3.11 -y", shell=True, check=True)

def install_dependencies():
    """安装依赖"""
    print("\n========== 安装依赖 ==========")
    # 检查jieba_fast whl文件是否存在
    if os.path.exists("jieba_fast-0.53-cp311-cp311-win_amd64.whl"):
        run_in_conda_env("pip install jieba_fast-0.53-cp311-cp311-win_amd64.whl -i https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple")
    else:
        print("警告: jieba_fast-0.53-cp311-cp311-win_amd64.whl 文件不存在，跳过安装")

    # 检查requirements.txt是否存在
    if os.path.exists("requirements.txt"):
        run_in_conda_env("pip install -i https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple -r requirements.txt")
    else:
        print("警告: requirements.txt 文件不存在，跳过安装")

    # 安装ffmpeg
    print("\n========== 安装ffmpeg ==========")
    run_in_conda_env("conda install ffmpeg -y")
    
    # 安装modelscope
    print("\n========== 安装ModelScope ==========")
    run_in_conda_env("pip install -i https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple modelscope")
    
    # 安装pytorch
    print("\n========== 安装PyTorch (CUDA 11.8) ==========")
    run_in_conda_env("pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118")

def download_live2d_model():
    """下载并解压Live 2D模型"""
    print("\n========== 下载Live 2D模型 ==========")
    # GitHub文件下载链接
    url = "https://github.com/morettt/my-neuro/releases/download/v4.4.1/live-2d.zip"
    # 获取文件名
    file_name = url.split('/')[-1]
    
    # 创建目标文件夹
    target_folder = "live 2d"
    
    # 下载文件
    downloaded_file = download_file(url, file_name)
    
    # 解压文件
    extract_success = extract_zip(downloaded_file, target_folder)
    
    # 清理：删除ZIP文件
    if extract_success and os.path.exists(downloaded_file):
        os.remove(downloaded_file)
        print(f"原ZIP文件 {downloaded_file} 已删除")

def download_vad_models():
    """下载asr的vad"""
    vad_dir = os.getcwd()

    target_dir = os.path.join(vad_dir,'model','torch_hub')
    os.makedirs(target_dir,exist_ok=True)

    model_dir = snapshot_download('morelle/my-neuro-vad',local_dir =target_dir)

    print(f'已讲asr vad下载到{model_dir}')


def download_tts_models():
    """下载TTS相关模型"""
    # 获取当前工作目录
    current_dir = os.getcwd()
    
    print("\n========== 开始下载TTS相关模型 ==========")
    
    # 1. 下载ernie模型到bert-model文件夹
    bert_model_dir = os.path.join(current_dir, "bert-model")
    if not os.path.exists(bert_model_dir):
        os.makedirs(bert_model_dir)
    
    # 切换到bert-model目录
    os.chdir(bert_model_dir)
    print(f"\n下载ernie模型到: {os.getcwd()}")
    
    # 使用ModelScope下载ernie模型，带重试机制
    if not download_with_retry("call conda activate my-neuro && modelscope download --model morelle/ernie-3.0-base-zh-Vision-FT --local_dir ./"):
        print("ernie模型下载失败，终止程序")
        return False
    
    # 检查下载的模型是否存在
    ernie_model_files = ["config.json", "model.safetensors", "vocab.txt"]
    missing_files = [f for f in ernie_model_files if not os.path.exists(os.path.join(bert_model_dir, f))]
    if missing_files:
        print(f"错误：下载后无法找到ernie模型的关键文件: {', '.join(missing_files)}")
        return False
    print("ernie模型检查通过，关键文件已找到")
    
    # 2. 下载G2PWModel到tts-studio/text文件夹
    # 返回到原始目录
    os.chdir(current_dir)
    
    # 创建tts-studio/text路径
    tts_studio_dir = os.path.join(current_dir, "tts-studio")
    text_dir = os.path.join(tts_studio_dir, "text")
    if not os.path.exists(text_dir):
        os.makedirs(text_dir)
    
    # 创建专门的G2PWModel文件夹
    g2pw_model_dir = os.path.join(text_dir, "G2PWModel")
    if not os.path.exists(g2pw_model_dir):
        os.makedirs(g2pw_model_dir)
    
    # 切换到G2PWModel目录
    os.chdir(g2pw_model_dir)
    print(f"\n下载G2PWModel到: {os.getcwd()}")
    
    # 使用ModelScope下载G2PWModel，带重试机制
    if not download_with_retry("call conda activate my-neuro && modelscope download --model zxm2493188292/G2PWModel --local_dir ./"):
        print("G2PWModel下载失败，终止程序")
        return False
    
    # 检查下载的G2PWModel是否存在
    if not os.listdir(g2pw_model_dir):
        print(f"错误：下载后G2PWModel目录为空 {g2pw_model_dir}")
        return False
    print("G2PWModel模型下载检查通过，文件已找到")
    
    # 3. 复制G2PWModel到tts-studio/GPT_SoVITS/text文件夹
    # 返回到原始目录
    os.chdir(current_dir)
    
    # 源文件夹路径 - 现在是专门的G2PWModel文件夹
    source_g2pw_dir = g2pw_model_dir
    
    # 目标文件夹路径
    gpt_sovits_dir = os.path.join(tts_studio_dir, "GPT_SoVITS")
    gpt_text_dir = os.path.join(gpt_sovits_dir, "text")
    target_g2pw_dir = os.path.join(gpt_text_dir, "G2PWModel")
    
    # 创建目标目录结构
    if not os.path.exists(gpt_sovits_dir):
        os.makedirs(gpt_sovits_dir)
    if not os.path.exists(gpt_text_dir):
        os.makedirs(gpt_text_dir)
    
    # 复制文件夹
    print(f"\n复制G2PWModel从 {source_g2pw_dir} 到 {target_g2pw_dir}")
    # 如果目标文件夹已存在，先删除
    if os.path.exists(target_g2pw_dir):
        shutil.rmtree(target_g2pw_dir)
    # 复制整个文件夹
    try:
        shutil.copytree(source_g2pw_dir, target_g2pw_dir)
        print("复制完成！")
    except Exception as e:
        print(f"复制过程中出错: {str(e)}")
        return False
    
    # 4. 下载并解压pretrained_models.zip到tts-studio/GPT_SoVITS/pretrained_models文件夹
    # 创建目标目录
    pretrained_models_dir = os.path.join(gpt_sovits_dir, "pretrained_models")
    if not os.path.exists(pretrained_models_dir):
        os.makedirs(pretrained_models_dir)
    
    # 返回到原始目录
    os.chdir(current_dir)
    
    # 切换到GPT_SoVITS目录
    print(f"\n下载GPT-SoVITS预训练模型到: {gpt_sovits_dir}")
    
    # 使用ModelScope下载GPT-SoVITS预训练模型，带重试机制
    if not download_with_retry("call conda activate my-neuro && modelscope download --model AI-ModelScope/GPT-SoVITS --local_dir ./tts-studio/GPT_SoVITS/pretrained_models"):
        print("GPT-SoVITS预训练模型下载失败，终止程序")
        return False
    
    # 确认模型已下载
    if not os.path.exists(pretrained_models_dir) or not os.listdir(pretrained_models_dir):
        print(f"错误：下载后无法找到预训练模型目录或目录为空: {pretrained_models_dir}")
        return False
    
    print(f"预训练模型已成功下载到: {pretrained_models_dir}")
    
    # 5. 复制预训练模型到tts-studio/pretrained_models文件夹
    # 确保我们在当前工作目录
    os.chdir(current_dir)
    
    # 创建目标目录
    tts_pretrained_dir = os.path.join(tts_studio_dir, "pretrained_models")
    if not os.path.exists(tts_pretrained_dir):
        os.makedirs(tts_pretrained_dir)
        print(f"创建目录: {tts_pretrained_dir}")
    
    # 源文件夹中的所有文件
    source_pretrained_dir = pretrained_models_dir
    print(f"\n正在将预训练模型从 {source_pretrained_dir} 复制到 {tts_pretrained_dir}")
    
    # 检查源文件夹中是否有文件
    if os.path.exists(source_pretrained_dir) and os.listdir(source_pretrained_dir):
        # 复制文件夹中的所有内容
        print(f"复制预训练模型文件...")
        try:
            # 遍历源目录中的所有文件和文件夹
            for item in os.listdir(source_pretrained_dir):
                source_item = os.path.join(source_pretrained_dir, item)
                target_item = os.path.join(tts_pretrained_dir, item)
                
                # 如果是文件夹，递归复制整个文件夹
                if os.path.isdir(source_item):
                    if os.path.exists(target_item):
                        shutil.rmtree(target_item)  # 如果目标已存在，先删除
                    shutil.copytree(source_item, target_item)
                    print(f"已复制文件夹: {item}")
                # 如果是文件，直接复制
                else:
                    shutil.copy2(source_item, target_item)
                    print(f"已复制文件: {item}")
            
            print("预训练模型复制完成")
        except Exception as e:
            print(f"复制预训练模型时出错: {str(e)}")
            return False
    else:
        print(f"错误：源预训练模型文件夹 {source_pretrained_dir} 不存在或为空")
        return False
    
    # 6. 下载fake_neuro_V2模型
    print("\n开始下载fake_neuro_V2模型...")
    
    # 创建tts-model目录
    tts_model_dir = os.path.join(tts_studio_dir, "tts-model")
    if not os.path.exists(tts_model_dir):
        os.makedirs(tts_model_dir)
        print(f"创建目录: {tts_model_dir}")
    
    # 切换到tts-model目录
    os.chdir(tts_model_dir)
    print(f"下载fake_neuro_V2模型到: {os.getcwd()}")
    
    # 使用ModelScope下载fake_neuro_V2模型，带重试机制
    download_success = download_with_retry("call conda activate my-neuro && modelscope download --model morelle/Fake-Neuro-TTS-V2 --local_dir ./")
    if not download_success:
        print("fake_neuro_V2模型下载失败，但这是可选模型，继续执行")
    else:
        print("fake_neuro_V2模型下载成功！")
    
    # 7. 下载Mnemosyne-V1-bert模型
    print("\n开始下载Mnemosyne-V1-bert模型...")
    
    # 返回到原始目录
    os.chdir(current_dir)
    print(f"下载Mnemosyne-V1-bert模型到: {current_dir}")
    
    # 使用ModelScope下载Mnemosyne-V1-bert模型，带重试机制
    download_success = download_with_retry("call conda activate my-neuro && modelscope download --model morelle/Mnemosyne-V1-bert --local_dir ./Mnemosyne-bert")
    if not download_success:
        print("Mnemosyne-V1-bert模型下载失败，但这是可选模型，继续执行")
    else:
        print("Mnemosyne-V1-bert模型下载成功！")
    
    return True

def main():
    print("开始部署环境！看看你运气怎么样？")
    
    # 下载并解压Live 2D模型
    download_live2d_model()
    # 部署conda环境
    setup_conda_environment()
    install_dependencies()
    
    print("\n环境全部部署成功，开始下载所有模型！")
    
    # 下载TTS模型
    success = download_tts_models()
    if success:
        print("\n所有下载操作全部完成！")
    else:
        print("\n部分模型下载失败，请检查错误信息并重试。")

if __name__ == "__main__":
    main()
