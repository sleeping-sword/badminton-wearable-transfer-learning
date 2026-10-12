"""
將 Garmin 手錶輸出的 JSON 感測器資料視覺化。

畫出兩張圖：
1. 加速度計 (accX, accY, accZ) - 時間對振幅
2. 陀螺儀 (gyroX, gyroY, gyroZ) - 時間對振幅

圖會存成 PNG 檔（同資料夾，檔名加 _acc.png / _gyro.png），因為此環境沒有 GUI 顯示後端。

使用方式：
    python3 visualize_garmin_json.py garmin_20260917_210444.json
"""

import argparse
import json
from pathlib import Path

import matplotlib.pyplot as plt

# 讓中文字能正常顯示。matplotlib 的字體管理員實際掃到的中文字體名稱是
# "Noto Sans CJK JP"（雖然叫 JP，但字型檔本身也涵蓋繁體中文字）。
plt.rcParams["font.sans-serif"] = ["Noto Sans CJK JP", "AR PL UMing CN", "DejaVu Sans"]
plt.rcParams["axes.unicode_minus"] = False


def load_data(json_path: Path) -> dict:
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    return data


def plot_sensor(time_s, series_dict, title, ylabel, colors, save_path=None):
    """
    time_s: 時間陣列（秒）
    series_dict: {"欄位名稱": [數值...]}
    colors: {"欄位名稱": "顏色"}
    """
    plt.figure(figsize=(14, 5))
    for name, values in series_dict.items():
        plt.plot(time_s, values, label=name, color=colors[name], linewidth=0.8)

    plt.axhline(0, color="gray", linewidth=0.8, linestyle="--")  # 標出 0 軸，方便看正負
    plt.title(title)
    plt.xlabel("時間 (秒)")
    plt.ylabel(ylabel)
    plt.legend(loc="upper right")
    plt.grid(True, alpha=0.3)
    plt.tight_layout()

    if save_path:
        plt.savefig(save_path, dpi=150)
        print(f"已儲存圖檔：{save_path}")


def main():
    parser = argparse.ArgumentParser(description="視覺化 Garmin JSON 感測器資料")
    parser.add_argument("json_file", type=str, help="輸入的 JSON 檔案路徑")
    args = parser.parse_args()

    json_path = Path(args.json_file)
    data = load_data(json_path)

    columns = data["columns"]  # ["time_ms","accX","accY","accZ","gyroX","gyroY","gyroZ"]
    samples = data["samples"]

    col_index = {name: i for i, name in enumerate(columns)}

    time_s = [row[col_index["time_ms"]] / 1000.0 for row in samples]

    # 原始資料單位為毫 G / 毫度每秒（Garmin Connect IQ Sensor API），除以 1000 轉成 G 和 度/秒
    acc_series = {
        "accX": [row[col_index["accX"]] / 1000.0 for row in samples],
        "accY": [row[col_index["accY"]] / 1000.0 for row in samples],
        "accZ": [row[col_index["accZ"]] / 1000.0 for row in samples],
    }
    acc_colors = {"accX": "red", "accY": "green", "accZ": "blue"}

    gyro_series = {
        "gyroX": [row[col_index["gyroX"]] / 1000.0 for row in samples],
        "gyroY": [row[col_index["gyroY"]] / 1000.0 for row in samples],
        "gyroZ": [row[col_index["gyroZ"]] / 1000.0 for row in samples],
    }
    gyro_colors = {"gyroX": "red", "gyroY": "green", "gyroZ": "blue"}

    # 這台機器沒有 GUI 顯示後端，plt.show() 不會跳出視窗，因此一律存成 PNG 檔供檢視
    acc_save_path = json_path.with_name(json_path.stem + "_acc.png")
    gyro_save_path = json_path.with_name(json_path.stem + "_gyro.png")

    plot_sensor(
        time_s,
        acc_series,
        title=f"加速度計 (Accelerometer) - {json_path.name}",
        ylabel="加速度 (G)",
        colors=acc_colors,
        save_path=acc_save_path,
    )

    plot_sensor(
        time_s,
        gyro_series,
        title=f"陀螺儀 (Gyroscope) - {json_path.name}",
        ylabel="角速度 (度/秒)",
        colors=gyro_colors,
        save_path=gyro_save_path,
    )

    print(f"完成！請打開以下圖檔查看：\n  {acc_save_path}\n  {gyro_save_path}")


if __name__ == "__main__":
    main()
