"""
Garmin 手錶資料的讀取與單位換算（dataset_2026 共用）。

所有「Garmin 原始值 → 舊模型單位」的換算都集中在這個檔案，
cut/ 裡的 csv 一律存原始值，之後單位確認了只要改這裡的常數，不用重新斷拍。

舊資料（cut_data/挑cut、推cut）的格式：
    無表頭、8 欄：t, accX, accY, accZ (m/s²), t, gyroX, gyroY, gyroZ (rad/s)，每拍 125 列 @100Hz
模型輸入：(125, 6) = acc xyz + gyro xyz
"""

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

SAMPLE_RATE_HZ = 100
COLUMNS = ["time_ms", "accX", "accY", "accZ", "gyroX", "gyroY", "gyroZ"]
ACC_COLS = ["accX", "accY", "accZ"]
GYRO_COLS = ["gyroX", "gyroY", "gyroZ"]

# 每拍的視窗：峰值前 50 筆、後 75 筆，共 125 筆（跟學長姐的斷拍一致，也是模型的輸入長度）
PRE_SAMPLES = 50
POST_SAMPLES = 75
WINDOW = PRE_SAMPLES + POST_SAMPLES

# 加速度：Garmin 原始值是 milli-g → m/s²
ACC_RAW_TO_MS2 = 9.80665 / 1000.0

# 陀螺儀：原始值是 int16 計數（±32764 飽和），1 原始值 ≈ 0.0365 度/秒，滿刻度約 ±1194 dps。
# 2026-10-14 用 pilot/校正.json 校正（手錶繞 Y 軸翻一整圈）：陀螺儀積分 vs 重力方向轉了 359.3°，
# 兩種算法（頭尾總角度、逐點擬合）結果相差 < 0.1%。重跑：scripts/calibrate_gyro.py
GYRO_FULL_SCALE_DPS = 1194.0
GYRO_RAW_TO_RAD_S = np.deg2rad(GYRO_FULL_SCALE_DPS / 32768.0)
GYRO_UNIT_VERIFIED = True


def load_recording(json_path) -> pd.DataFrame:
    """讀手錶輸出的整段錄製 json，回傳原始值的 DataFrame（欄位見 COLUMNS）。"""
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return pd.DataFrame(data["samples"], columns=data["columns"])[COLUMNS]


def load_stroke(csv_path) -> pd.DataFrame:
    """讀 cut/ 裡的單拍 csv（有表頭、原始值）。"""
    return pd.read_csv(csv_path)


def to_model_units(df: pd.DataFrame) -> np.ndarray:
    """原始值 → (N, 6) 的 [acc xyz (m/s²), gyro xyz (rad/s)]，欄位順序跟舊模型輸入相同。"""
    if not GYRO_UNIT_VERIFIED:
        warnings.warn("Garmin 陀螺儀單位尚未確認，目前用暫定換算（garmin_io.GYRO_FULL_SCALE_DPS）", stacklevel=2)
    acc = df[ACC_COLS].to_numpy(dtype=float) * ACC_RAW_TO_MS2
    gyro = df[GYRO_COLS].to_numpy(dtype=float) * GYRO_RAW_TO_RAD_S
    return np.hstack([acc, gyro])


def load_stroke_for_model(csv_path) -> np.ndarray:
    """單拍 csv → (125, 6)，可直接疊成模型的 X。"""
    x = to_model_units(load_stroke(csv_path))
    if x.shape != (WINDOW, 6):
        raise ValueError(f"{Path(csv_path).name} 的形狀是 {x.shape}，不是 ({WINDOW}, 6)")
    return x
