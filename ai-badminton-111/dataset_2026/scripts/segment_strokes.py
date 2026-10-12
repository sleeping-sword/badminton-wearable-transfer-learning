"""
斷拍：把 raw/ 裡整段錄製的 Garmin json 切成一拍一個 csv。

方法沿用學長姐 斷拍.ipynb 的想法（三軸角速度合量超過門檻 = 一次揮拍，
門檻 = 0.7×平均 + 0.3×最大，每拍取峰值前 50 筆、後 75 筆），差別：
  - 用 find_peaks 找「真正的局部最大值」，而不是超過門檻後 10 筆內的最大值
  - 視窗不完整（太靠近檔頭/檔尾）的拍直接略過，確保每個 csv 都是 125 列
  - 視窗內有陀螺儀掉資料（連續全 0）或接近飽和的拍會在索引表的 flag 欄標記

輸出：
  cut/<日期>/<錄製>/<錄製>_NN.csv   每拍一檔（有表頭、Garmin 原始值）
  cut/strokes_index.csv            所有拍的索引（一拍一列）
  plots/<日期>/<錄製>_segments.png  斷拍結果檢查圖

使用方式（在 dataset_2026/ 底下）：
    python3 scripts/segment_strokes.py                       # 處理 raw/ 底下全部
    python3 scripts/segment_strokes.py raw/2026_10_01/xxx.json
"""

import argparse
import re
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from scipy.signal import find_peaks

from garmin_io import COLUMNS, GYRO_COLS, POST_SAMPLES, PRE_SAMPLES, SAMPLE_RATE_HZ, load_recording

plt.rcParams["font.sans-serif"] = ["Noto Sans CJK JP", "AR PL UMing CN", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "raw"
CUT_DIR = ROOT / "cut"
PLOT_DIR = ROOT / "plots"
INDEX_PATH = CUT_DIR / "strokes_index.csv"

STROKES = ["高", "推", "挑"]
MIN_GAP_SAMPLES = 100  # 兩拍峰值至少間隔 1 秒
GYRO_SATURATION = 32000  # 原始值在 ±32764 飽和
DROPOUT_RUN = 10  # 陀螺儀連續這麼多筆全 0 視為掉資料

INDEX_COLUMNS = [
    "stroke_id", "date", "recording", "stroke_type", "stroke_no", "csv_path",
    "peak_idx", "peak_time_ms", "start_idx", "end_idx", "peak_gyro_mag", "gap_prev_s", "flag",
]


def parse_name(json_path: Path):
    """garmin_20261001_195336高.json → ('2026_10_01', '20261001_195336高', '高')"""
    m = re.match(r"garmin_((\d{4})(\d{2})(\d{2})_\d{6}.*)$", json_path.stem)
    if not m:
        raise ValueError(f"檔名格式不符：{json_path.name}")
    recording = m.group(1)
    stroke = next((s for s in STROKES if s in recording), None)
    if stroke is None:
        raise ValueError(f"檔名裡找不到球種（{'/'.join(STROKES)}）：{json_path.name}")
    return f"{m.group(2)}_{m.group(3)}_{m.group(4)}", recording, stroke


def dropout_mask(gyro: np.ndarray) -> np.ndarray:
    """陀螺儀三軸連續 DROPOUT_RUN 筆以上全 0 的位置。"""
    zero = (gyro == 0).all(axis=1)
    mask = np.zeros(len(zero), dtype=bool)
    edges = np.flatnonzero(np.diff(np.r_[0, zero.astype(int), 0]))
    for start, end in zip(edges[::2], edges[1::2]):
        if end - start >= DROPOUT_RUN:
            mask[start:end] = True
    return mask


def segment(json_path: Path) -> pd.DataFrame:
    date, recording, stroke = parse_name(json_path)
    df = load_recording(json_path)
    gyro = df[GYRO_COLS].to_numpy(dtype=float)
    mag = np.linalg.norm(gyro, axis=1)
    threshold = 0.7 * mag.mean() + 0.3 * mag.max()
    peaks, _ = find_peaks(mag, height=threshold, distance=MIN_GAP_SAMPLES)

    complete = (peaks - PRE_SAMPLES >= 0) & (peaks + POST_SAMPLES <= len(df))
    skipped = peaks[~complete]
    peaks = peaks[complete]
    dropped = dropout_mask(gyro)

    out_dir = CUT_DIR / date / recording
    out_dir.mkdir(parents=True, exist_ok=True)
    for old in out_dir.glob(f"{recording}_*.csv"):  # 重跑時清掉上一次的結果
        old.unlink()

    rows = []
    for no, peak in enumerate(peaks, start=1):
        start, end = peak - PRE_SAMPLES, peak + POST_SAMPLES
        stroke_id = f"{recording}_{no:02d}"
        csv_path = out_dir / f"{stroke_id}.csv"
        df.iloc[start:end][COLUMNS].to_csv(csv_path, index=False)

        flags = []
        if dropped[start:end].any():
            flags.append("gyro_dropout")
        if np.abs(gyro[start:end]).max() >= GYRO_SATURATION:
            flags.append("gyro_saturated")
        rows.append({
            "stroke_id": stroke_id,
            "date": date,
            "recording": recording,
            "stroke_type": stroke,
            "stroke_no": no,
            "csv_path": csv_path.relative_to(ROOT).as_posix(),
            "peak_idx": int(peak),
            "peak_time_ms": int(df["time_ms"].iloc[peak]),
            "start_idx": int(start),
            "end_idx": int(end),
            "peak_gyro_mag": round(float(mag[peak]), 1),
            "gap_prev_s": "" if no == 1 else round((peak - peaks[no - 2]) / SAMPLE_RATE_HZ, 2),
            "flag": "|".join(flags),
        })

    plot_segments(mag, threshold, peaks, skipped, dropped, PLOT_DIR / date / f"{recording}_segments.png", recording)
    note = f"（略過 {len(skipped)} 拍：視窗不完整）" if len(skipped) else ""
    print(f"{recording}: {len(peaks)} 拍{note}")
    return pd.DataFrame(rows, columns=INDEX_COLUMNS)


def plot_segments(mag, threshold, peaks, skipped, dropped, save_path: Path, title: str):
    t = np.arange(len(mag)) / SAMPLE_RATE_HZ
    fig, ax = plt.subplots(figsize=(18, 4.5))
    for peak in peaks:
        ax.axvspan((peak - PRE_SAMPLES) / SAMPLE_RATE_HZ, (peak + POST_SAMPLES) / SAMPLE_RATE_HZ,
                   color="#d9d9d9", linewidth=0)
    if dropped.any():
        ax.fill_between(t, 0, mag.max(), where=dropped, color="#c0392b", alpha=0.25, linewidth=0,
                        label="陀螺儀掉資料")
    ax.plot(t, mag, color="#2f5d8a", linewidth=1, label="角速度合量")
    ax.axhline(threshold, color="#555555", linewidth=1, linestyle="--", label="門檻")
    for no, peak in enumerate(peaks, start=1):
        ax.annotate(str(no), (t[peak], mag[peak]), textcoords="offset points", xytext=(0, 4),
                    ha="center", fontsize=8, color="#222222")
    if len(skipped):
        ax.plot(t[skipped], mag[skipped], "x", color="#c0392b", markersize=8, label="略過（視窗不完整）")
    ax.set_title(f"{title}　斷拍結果：{len(peaks)} 拍（灰底 = 每拍的 125 筆視窗）", loc="left")
    ax.set_xlabel("時間 (秒)")
    ax.set_ylabel("角速度合量（原始值）")
    ax.set_xlim(0, t[-1])
    ax.set_ylim(0, mag.max() * 1.1)
    ax.spines[["top", "right"]].set_visible(False)
    ax.legend(loc="upper right", frameon=False, ncol=4)
    fig.tight_layout()
    save_path.parent.mkdir(parents=True, exist_ok=True)
    fig.savefig(save_path, dpi=130)
    plt.close(fig)


def update_index(new_rows: pd.DataFrame):
    """把這次處理的錄製寫進索引表（同一個錄製的舊列會被取代）。"""
    if INDEX_PATH.exists():
        old = pd.read_csv(INDEX_PATH, dtype=str, keep_default_na=False)
        old = old[~old["recording"].isin(new_rows["recording"].unique())]
        new_rows = pd.concat([old, new_rows.astype(str)], ignore_index=True)
    new_rows = new_rows.sort_values("stroke_id")
    new_rows.to_csv(INDEX_PATH, index=False, encoding="utf-8-sig")


def main():
    parser = argparse.ArgumentParser(description="Garmin json 斷拍")
    parser.add_argument("json_files", nargs="*", type=Path, help="要處理的 json（不給就處理 raw/ 底下全部）")
    args = parser.parse_args()

    files = args.json_files or sorted(RAW_DIR.glob("*/garmin_*.json"))
    if not files:
        parser.error(f"{RAW_DIR} 底下沒有 json")
    update_index(pd.concat([segment(f) for f in files], ignore_index=True))
    print(f"索引表：{INDEX_PATH}")


if __name__ == "__main__":
    main()
