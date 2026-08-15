# from pathlib import Path
# import pandas as pd

# # 路徑（注意這裡不用再寫 AI-Badminton-111）
# txt_path = Path("1028/10281推.txt")

# # 讀檔
# df = pd.read_csv(txt_path, header=None)

# # 印出結果
# print("shape:", df.shape)
# print(df.head())

from pathlib import Path
import pandas as pd

txt_path = Path("1028/10281推.txt")
df = pd.read_csv(txt_path, header=None)

print("原始 shape:", df.shape)
print(df.head())

df.columns = [
    "t1", "acc_x", "acc_y", "acc_z",
    "t2", "gyro_x", "gyro_y", "gyro_z"
]

print("\n改名後：")
print(df.head())

same_time = (df["t1"] == df["t2"]).all()
print("\nt1 和 t2 是否完全相同：", same_time)