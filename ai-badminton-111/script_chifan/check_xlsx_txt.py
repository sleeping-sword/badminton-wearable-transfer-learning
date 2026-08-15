# from pathlib import Path
# import pandas as pd

# repo_dir = Path(".")

# target_files = [
#     "10281挑", "10282挑", "10283挑", "10284挑補", "10285挑補", "10286挑", "10287挑", "10288挑",
#     "10301挑", "10302挑", "10303挑", "10304挑", "10305挑", "11011挑", "11012挑", "11013挑",
#     "11014挑", "11015挑", "11017挑", "11018挑", "11019挑", "110110挑", "110111挑", "110112挑",
#     "110113挑", "110114挑", "110115挑", "110116挑", "110117挑", "110118挑", "110119挑", "110120挑",
#     "110121挑", "110122挑", "110123挑", "110124挑", "110125挑", "110126挑", "110127挑", "110128挑",
#     "110129挑", "110130挑", "110131挑", "110132挑", "110133挑", "110134挑", "110135挑", "110136挑",
#     "110137挑", "110138挑", "110139挑", "110140挑", "110141挑", "110142挑", "11041挑", "11131挑",
#     "11132挑", "11201挑", "11202挑",
#     "10281推", "10282推", "10283推", "10284推補", "10285推", "10286推", "10287推", "10288推",
#     "10301推", "10302推", "10303推", "10304推", "10305推", "11011推", "11012推", "11013推",
#     "11014推", "11015推", "11016推", "11017推", "11018推", "11019推", "110110推", "110111推",
#     "110112推", "110113推", "110114推", "110115推", "110116推", "110117推", "110118推", "110119推",
#     "110120推", "110121推", "110122推", "110123推", "110124推", "110125推", "110126推", "110127推",
#     "110128推補", "110131推", "110132推", "110133推", "110134推", "110135推", "110136推", "110137推",
#     "110138推", "110139推", "110140推", "110141推", "110142推", "11041推", "11131推", "11132推",
#     "11201推", "11202推"
# ]

# summary_rows = []
# all_data = {}

# for name in target_files:
#     matches = list(repo_dir.rglob(f"{name}.txt"))
#     if len(matches) != 1:
#         print(f"[路徑異常] {name}: {matches}")
#         continue

#     txt_path = matches[0]
#     df = pd.read_csv(txt_path, header=None)
#     df.columns = ["t1", "acc_x", "acc_y", "acc_z", "t2", "gyro_x", "gyro_y", "gyro_z"]

#     df = df[["t1", "acc_x", "acc_y", "acc_z", "gyro_x", "gyro_y", "gyro_z"]]
#     df = df.rename(columns={"t1": "time"})

#     all_data[name] = df

#     summary_rows.append({
#         "file_name": name,
#         "path": str(txt_path),
#         "n_rows": len(df),
#         "stroke_type": "挑" if "挑" in name else "推"
#     })

# summary_df = pd.DataFrame(summary_rows)
# summary_df = summary_df.sort_values(by="file_name")
# summary_df.to_csv("imu_file_summary.csv", index=False, encoding="utf-8-sig")

# print("成功整理筆數:", len(summary_df))
# print(summary_df.head())
# print("\n已輸出 imu_file_summary.csv")

import pandas as pd

xlsx_path = "羽球評分(全).xlsx"
csv_path = "scores_raw.csv"

df = pd.read_excel(xlsx_path)
df.to_csv(csv_path, index=False, encoding="utf-8-sig")

print("已輸出:", csv_path)
print(df.head())
print(df.columns.tolist())
print(df.shape)