# Badminton Wearable Transfer Learning

本專題使用智慧手錶收集羽球揮拍時的六軸 IMU 資料，並結合深度學習與遷移學習，分析高遠球模型是否能轉移至挑球與平推球的動作評分任務。

## Project Structure

```text
watch_app/
  garmin/
    Enter/              Garmin 手錶端程式

mobile_app/
  android/
    GarminReceiver/     Android 手機端接收資料程式

recruitment_tool/       受試者招募表單面板與邀請信（Google Apps Script）
