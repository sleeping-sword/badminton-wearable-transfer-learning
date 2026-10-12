"""
把斷拍的斷點畫在原始波形上：上圖三軸加速度、下圖三軸角速度，
每一拍的起點與終點各一條垂直虛線，兩條虛線中間標拍號。

斷點讀自 cut/strokes_index.csv，所以要先跑過 segment_strokes.py。
輸出：plots/<日期>/<錄製>_cutpoints.png

使用方式（在 dataset_2026/ 底下）：
    python3 scripts/plot_cut_points.py 20261001_195336高 20261001_195714推
"""

import argparse

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import pandas as pd

from garmin_io import ACC_COLS, GYRO_COLS, SAMPLE_RATE_HZ, load_recording
from segment_strokes import INDEX_PATH, PLOT_DIR, RAW_DIR

plt.rcParams["font.sans-serif"] = ["Noto Sans CJK JP", "AR PL UMing CN", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

SURFACE = "#fcfcfb"
AXIS_COLORS = ["#2a78d6", "#eb6834", "#1baf7a"]  # X / Y / Z
CUT_COLOR = "#0b0b0b"
SECONDS_PER_INCH = 4  # 圖寬跟著錄製長度走，每拍才看得清楚


def plot_recording(recording: str, index: pd.DataFrame):
    strokes = index[index["recording"] == recording]
    if strokes.empty:
        raise SystemExit(f"strokes_index.csv 裡沒有 {recording}，請先跑 segment_strokes.py")
    date = strokes["date"].iloc[0]
    df = load_recording(RAW_DIR / date / f"garmin_{recording}.json")
    t = df["time_ms"] / 1000.0

    width = max(18, len(df) / SAMPLE_RATE_HZ / SECONDS_PER_INCH)
    fig, axes = plt.subplots(2, 1, figsize=(width, 8), sharex=True, facecolor=SURFACE)
    panels = [
        (axes[0], ACC_COLS, df[ACC_COLS] / 1000.0, "加速度 (G)"),
        (axes[1], GYRO_COLS, df[GYRO_COLS], "角速度（原始值，單位未確認）"),
    ]
    for ax, cols, values, ylabel in panels:
        ax.set_facecolor(SURFACE)
        for col, color in zip(cols, AXIS_COLORS):
            ax.plot(t, values[col], color=color, linewidth=1, label=col)
        for start, end in zip(strokes["start_idx"], strokes["end_idx"]):
            for idx in (start, end):
                ax.axvline(idx / SAMPLE_RATE_HZ, color=CUT_COLOR, linewidth=0.9, linestyle=(0, (4, 3)))
        ax.axhline(0, color="#b5b4ae", linewidth=0.6, zorder=0)
        ax.set_ylabel(ylabel)
        ax.spines[["top", "right"]].set_visible(False)
        ax.legend(loc="center left", bbox_to_anchor=(1.0, 0.5), frameon=False)

    top = axes[0].get_ylim()[1]
    for no, start, end in zip(strokes["stroke_no"], strokes["start_idx"], strokes["end_idx"]):
        axes[0].text((start + end) / 2 / SAMPLE_RATE_HZ, top, str(no), ha="center", va="bottom",
                     fontsize=9, color=CUT_COLOR)

    axes[0].set_title(f"{recording}　斷點（虛線 = 每一拍的起點與終點，共 {len(strokes)} 拍）", loc="left", pad=22)
    axes[1].set_xlabel("時間 (秒)")
    axes[1].set_xlim(0, t.iloc[-1])
    fig.tight_layout()
    save_path = PLOT_DIR / date / f"{recording}_cutpoints.png"
    save_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(save_path, dpi=110, facecolor=SURFACE)
    plt.close(fig)
    print(f"已儲存：{save_path}")


def main():
    parser = argparse.ArgumentParser(description="把斷點畫在原始波形上")
    parser.add_argument("recordings", nargs="+", help="錄製名稱，例如 20261001_195336高")
    args = parser.parse_args()
    index = pd.read_csv(INDEX_PATH, keep_default_na=False)
    for recording in args.recordings:
        plot_recording(recording, index)


if __name__ == "__main__":
    main()
