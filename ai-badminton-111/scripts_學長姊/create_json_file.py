import os
import json
import pandas as pd
import numpy as np
import math

class Data:
    acc_x: np.ndarray
    acc_y: np.ndarray
    acc_z: np.ndarray
    ang_acc_x: np.ndarray
    ang_acc_y: np.ndarray
    ang_acc_z: np.ndarray
    def __init__(self):
        self.acc_x = []
        self.acc_y = []
        self.acc_z = []
        self.ang_acc_x = []
        self.ang_acc_y = []
        self.ang_acc_z = []

json_list = []
data = Data()

grade_comment_path= "C:/Users/gordo/AI-badminton/data/grade_and_comment.csv"
df_grade_comment = pd.read_csv(grade_comment_path)
folder_path_first = "../data/folder_processed"

def create_json_file(file_name, file_number):
    print('start create json file.', file_name)
    json_list.append({
        "檔名":file_name,
        "評語":str(df_grade_comment.at[file_number,'評語']),
        
        "揮拍軌跡正確度":str(math.floor((df_grade_comment.at[file_number,'揮拍軌跡正確度'] - 1) / 2)),
        "揮拍速度流暢度":str(math.floor((df_grade_comment.at[file_number,'揮拍速度流暢度'] - 1) / 2)),
        "手腕轉動時機正確度":str(math.floor((df_grade_comment.at[file_number,'手腕轉動時機正確度'] - 1) / 2)),
        "擊球時機正確度":str(math.floor((df_grade_comment.at[file_number,'擊球時機正確度'] - 1) / 2)),
        "擊球位置正確度":str(math.floor((df_grade_comment.at[file_number,'擊球位置正確度'] - 1) / 2)),
        
        "x軸加速度":list(np.around(data.acc_x, 3)),
        "y軸加速度":list(np.around(data.acc_y, 3)),
        "z軸加速度":list(np.around(data.acc_z, 3)),
        "x軸角加速度":list(np.around(data.ang_acc_x, 3)),
        "y軸角加速度":list(np.around(data.ang_acc_y, 3)),
        "z軸角加速度":list(np.around(data.ang_acc_z, 3)),
    })

   
file_number = 0
for folder_name in sorted(os.listdir(folder_path_first)):
    folder_path = os.path.join(folder_path_first, folder_name)
    if os.listdir(folder_path):
        for file_name in sorted(os.listdir(folder_path)):
            file_path = os.path.join(folder_path, file_name)

            df = pd.read_csv(file_path, header=None)
            df.columns = ['時間','x軸加速度', 'y軸加速度', 'z軸加速度','x軸角加速度','y軸角加速度','z軸角加速度']
            data.acc_x = np.array(df['x軸加速度'].tolist())
            data.acc_y = np.array(df['y軸加速度'].tolist())
            data.acc_z = np.array(df['z軸加速度'].tolist())
            data.ang_acc_x = np.array(df['x軸角加速度'].tolist())
            data.ang_acc_y = np.array(df['y軸角加速度'].tolist())
            data.ang_acc_z = np.array(df['z軸角加速度'].tolist())
            create_json_file(file_name.split('.')[0], file_number)
        file_number += 1
    else:
        continue

# create new json file
output_file = 'C:/Users/gordo/AI-badminton/data/grade_and_comment_separate.json' 
with open(output_file, 'w', encoding='utf-8') as file:
    json.dump(json_list, file, ensure_ascii=False, indent=4)
print('create json file successfully!')




