import tensorflow as tf

model_paths = [
    "專題/models/model1.keras",
    "專題/models/model2.keras",
    "專題/models/model3.keras",
    "專題/models/model4.keras",
    "專題/models/model5.keras",
]

for path in model_paths:
    print(f"\n===== {path} =====")
    model = tf.keras.models.load_model(path)
    model.summary()

model = tf.keras.models.load_model("專題/models/model1.keras")
print(type(model))
for layer in model.layers:
    print(layer.name, type(layer).__name__)