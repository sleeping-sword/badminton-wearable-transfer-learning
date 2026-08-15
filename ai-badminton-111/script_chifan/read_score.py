# import pandas as pd

# xlsx_path = "/home/sabrina/AI-Badminton-111/羽球評分(全).xlsx"   # 如果檔名不同就改成你的實際檔名

# # 先看有哪些工作表
# xls = pd.ExcelFile(xlsx_path)
# print("工作表名稱：", xls.sheet_names)

# # 先讀第一個工作表試試
# df = pd.read_excel(xlsx_path, sheet_name=0)
# print(df.head())
# print(df.columns.tolist())
# print(df.shape)

import pandas as pd

# 讀兩個工作表
df_lift = pd.read_excel("羽球評分(全).xlsx", sheet_name="挑球")
df_push = pd.read_excel("羽球評分(全).xlsx", sheet_name="平推球")

# 加上球種欄位
df_lift["stroke_type"] = "挑"
df_push["stroke_type"] = "推"

# 合併
scores_df = pd.concat([df_lift, df_push], ignore_index=True)

# 讀你剛剛整理好的 imu 摘要表
imu_df = pd.read_csv("imu_file_summary.csv")

# 用檔名合併
merged_df = pd.merge(
    imu_df,
    scores_df,
    left_on="file_name",
    right_on="檔名",
    how="inner"
)

print("scores_df shape:", scores_df.shape)
print("merged_df shape:", merged_df.shape)
print(merged_df.head())

# 存起來
merged_df.to_csv("merged_scores_imu.csv", index=False, encoding="utf-8-sig")
print("已輸出 merged_scores_imu.csv")