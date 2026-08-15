import pandas as pd
import matplotlib.pyplot as plt
import matplotlib.font_manager as fm

# ---- 中文字體設定：直接指定檔案路徑，避免字體名稱抓不到 ----
font_path = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
my_font = fm.FontProperties(fname=font_path)
plt.rcParams['axes.unicode_minus'] = False

metric_names = [
    "揮拍軌跡正確度",
    "揮拍速度流暢度",
    "手腕轉動時機正確度",
    "擊球時機正確度",
    "擊球位置正確度"
]

data_dir = "/home/sabrina/AI-Badminton-111/fine-tune/0815新版fine_tune結果"

fig, axes = plt.subplots(5, 2, figsize=(12, 20))

for i, metric_name in enumerate(metric_names):

    df = pd.read_csv(f"{data_dir}/{metric_name}_累加受試者_finetune.csv")

    for j, stroke in enumerate(["挑球", "平推"]):

        ax = axes[i, j]
        sub = df[df["動作"] == stroke].sort_values("資料比例")

        x = sub["資料比例"]

        ax.errorbar(
            x, sub["Scratch_mean"], yerr=sub["Scratch_std"],
            marker="o", label="Scratch", capsize=4
        )
        ax.errorbar(
            x, sub["Transfer_mean"], yerr=sub["Transfer_std"],
            marker="s", label="Transfer", capsize=4
        )

        ax.set_title(f"{metric_name} - {stroke}", fontproperties=my_font)
        ax.set_xlabel("訓練資料比例", fontproperties=my_font)
        ax.set_ylabel("準確率", fontproperties=my_font)
        ax.set_ylim(0, 1)
        ax.axhline(1/3, color="gray", linestyle="--", linewidth=1, label="亂猜基準線")
        ax.legend(fontsize=8, prop=my_font)
        ax.grid(alpha=0.3)

plt.tight_layout()
plt.savefig(f"{data_dir}/transfer_vs_scratch_全指標.png", dpi=150)
plt.show()