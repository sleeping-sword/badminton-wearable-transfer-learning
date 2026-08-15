import numpy as np
import pandas as pd

merged_df = pd.read_csv("../merged_scores_imu.csv")

def load_imu_txt(txt_path):
    df = pd.read_csv(txt_path, header=None)
    df.columns = ["t1", "acc_x", "acc_y", "acc_z", "t2", "gyro_x", "gyro_y", "gyro_z"]
    df = df[["acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]]
    return df.values

def extract_features(arr):
    feat = {}
    cols = ["acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]

    for i, c in enumerate(cols):
        x = arr[:, i]
        feat[f"{c}_mean"] = np.mean(x)
        feat[f"{c}_std"] = np.std(x)
        feat[f"{c}_max"] = np.max(x)
        feat[f"{c}_min"] = np.min(x)

    return feat

rows = []

for _, row in merged_df.iterrows():
    arr = load_imu_txt("../" + row["path"])
    feats = extract_features(arr)

    rows.append({
        "file_name": row["file_name"],
        "stroke_type": row["stroke_type_x"],
        "trajectory": row["揮拍軌跡正確度"],
        "speed_flow": row["揮拍速度流暢度"],
        "wrist_timing": row["手腕轉動時機正確度"],
        "hit_timing": row["擊球時機正確度"],
        "hit_position": row["擊球位置正確度"],
        **feats
    })

feature_df = pd.DataFrame(rows)
feature_df.to_csv("../features_basic.csv", index=False, encoding="utf-8-sig")

print("feature_df shape:", feature_df.shape)
print(feature_df.head())
print("已輸出 ../features_basic.csv")