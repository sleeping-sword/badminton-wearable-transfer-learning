"""
用一段「轉已知角度」的校正錄製，算出 Garmin 陀螺儀原始值的單位。

錄法（手錶平放桌上，錶面朝上，側邊靠著一本書當基準）：
  1. 開始錄製，靜止 3 秒
  2. 貼著桌面把手錶慢慢轉一整圈（360°，約 3 秒轉完），轉回來再靠回書邊，靜止 3 秒
  3. 重複 3～5 次後停止錄製
  想順便驗另外兩軸，就把手錶立起來（側邊貼桌、錶帶方向貼桌）各錄一個檔。

使用方式：
    python3 scripts/calibrate_gyro.py pilot/garmin_xxx.json            # 預設每次轉 360°
    python3 scripts/calibrate_gyro.py pilot/garmin_xxx.json --angle 90
"""

import argparse

import numpy as np

from garmin_io import GYRO_COLS, SAMPLE_RATE_HZ, load_recording

STILL_COUNTS = 150  # 合量低於這個原始值視為靜止
MIN_MOVE_S = 0.5  # 短於這個秒數的動作不算一次旋轉
MERGE_GAP_S = 0.5  # 中間停頓短於這個秒數的動作併成同一次


def find_rotations(moving: np.ndarray):
    """回傳每次旋轉的 (start, end) 索引。"""
    edges = np.flatnonzero(np.diff(np.r_[0, moving.astype(int), 0]))
    segments = []
    for start, end in zip(edges[::2], edges[1::2]):
        if segments and start - segments[-1][1] < MERGE_GAP_S * SAMPLE_RATE_HZ:
            segments[-1][1] = end
        else:
            segments.append([start, end])
    return [(s, e) for s, e in segments if e - s >= MIN_MOVE_S * SAMPLE_RATE_HZ]


def main():
    parser = argparse.ArgumentParser(description="Garmin 陀螺儀單位校正")
    parser.add_argument("json_file")
    parser.add_argument("--angle", type=float, default=360.0, help="每次旋轉的角度（度）")
    args = parser.parse_args()

    gyro = load_recording(args.json_file)[GYRO_COLS].to_numpy(dtype=float)
    mag = np.linalg.norm(gyro, axis=1)
    still = mag < STILL_COUNTS
    gyro = gyro - gyro[still].mean(axis=0)  # 扣掉靜止時的零點偏移
    rotations = find_rotations(np.linalg.norm(gyro, axis=1) >= STILL_COUNTS)
    if not rotations:
        raise SystemExit("找不到旋轉的段落")

    scales = []
    for no, (start, end) in enumerate(rotations, start=1):
        integral = gyro[start:end].sum(axis=0) / SAMPLE_RATE_HZ  # 原始值 × 秒
        axis = int(np.argmax(np.abs(integral)))
        off_axis = 1 - abs(integral[axis]) / np.linalg.norm(integral)
        scale = args.angle / abs(integral[axis])  # 度/秒 per 原始值
        scales.append(scale)
        print(f"第 {no} 次：{(end - start) / SAMPLE_RATE_HZ:.1f} 秒，主軸 {GYRO_COLS[axis]}，"
              f"峰值 {np.abs(gyro[start:end, axis]).max():.0f}，偏軸 {off_axis:.0%}，"
              f"1 原始值 = {scale:.5f} 度/秒")

    scale = float(np.median(scales))
    print(f"\n中位數：1 原始值 = {scale:.5f} 度/秒（各次差異 ±{np.ptp(scales) / scale / 2:.0%}）")
    print(f"→ 滿刻度（32768）≈ ±{scale * 32768:.0f} 度/秒")
    print(f"→ garmin_io.py 請設 GYRO_FULL_SCALE_DPS = {scale * 32768:.0f}，並把 GYRO_UNIT_VERIFIED 改成 True")


if __name__ == "__main__":
    main()
