import os
import shutil

# 設定檔案的根目錄
source_directory = "C:/Users/gordo/AI-badminton/data/origin"  # 替換為檔案所在的資料夾
destination_directory = "C:/Users/gordo/AI-badminton/data/folder_processed"  # 替換為你想要存放資料夾的路徑

# 檢查目標資料夾是否存在，若不存在則建立
if not os.path.exists(destination_directory):
    os.makedirs(destination_directory)

# 遍歷範圍 h001 到 h200
for i in range(1, 204):
    prefix = f"h{i:03}"  # 格式化為 h001, h002, ..., h203
    target_folder = os.path.join(destination_directory, prefix)

    # 如果資料夾不存在，則建立
    if not os.path.exists(target_folder):
        os.makedirs(target_folder)

    # 移動符合 prefix 的檔案
    for filename in os.listdir(source_directory):
        if filename.startswith(prefix):
            source_path = os.path.join(source_directory, filename)
            destination_path = os.path.join(target_folder, filename)
            shutil.move(source_path, destination_path)
            print(f"Moved: {filename} to {target_folder}")