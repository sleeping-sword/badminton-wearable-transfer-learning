import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.multioutput import MultiOutputRegressor
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import numpy as np

# 讀資料
df = pd.read_csv("../features_basic.csv")

# 輸入特徵
feature_cols = [c for c in df.columns if c not in [
    "file_name", "stroke_type",
    "trajectory", "speed_flow", "wrist_timing", "hit_timing", "hit_position"
]]

# 預測目標
target_cols = ["trajectory", "speed_flow", "wrist_timing", "hit_timing", "hit_position"]

X = df[feature_cols]
y = df[target_cols]

# 切 train/test
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# 模型
model = MultiOutputRegressor(
    RandomForestRegressor(n_estimators=200, random_state=42)
)

model.fit(X_train, y_train)
y_pred = model.predict(X_test)

# 評估
mae = mean_absolute_error(y_test, y_pred)
rmse = np.sqrt(mean_squared_error(y_test, y_pred))
r2 = r2_score(y_test, y_pred)

print("X shape:", X.shape)
print("y shape:", y.shape)
print("MAE:", mae)
print("RMSE:", rmse)
print("R2:", r2)