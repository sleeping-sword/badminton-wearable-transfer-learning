#draw three axes acceleration and angular acceleration 
import os
import numpy as np
import matplotlib.pyplot as plt
import json
import pandas as pd
with open('../../data/v3_grade_and_comment.json', 'r', encoding='utf-8') as file:
    data = json.load(file)
df = pd.DataFrame(data)
start_draw_timestamp = 0
for i in range(0, len(data)):
    acc_x = np.array(data[i]["x軸平均加速度"]).reshape(-1, 1)
    acc_y = np.array(data[i]["y軸平均加速度"]).reshape(-1, 1)
    acc_z = np.array(data[i]["z軸平均加速度"]).reshape(-1, 1)
    ang_acc_x = np.array(data[i]["x軸平均角加速度"]).reshape(-1, 1)
    ang_acc_y = np.array(data[i]["y軸平均角加速度"]) .reshape(-1, 1)
    ang_acc_z = np.array(data[i]["z軸平均角加速度"]).reshape(-1, 1)

    data = np.concatenate((acc_x, acc_y, acc_z, ang_acc_x, ang_acc_y, ang_acc_z), axis = 1)
    print(data.shape)

    colors = ['blue', 'red', 'black', 'green', 'purple', 'brown']
    #以秒為單位(因為1秒收集100次)
    num_j_values = data.shape[0] / 100

    for k_index in range(0, data.shape[1]):
        k_values = data[start_draw_timestamp:, k_index]
        k_labels = ['x-acceleration', 'y-acceleration', 'z-acceleration', 'x-angular velocity', 'y-angular velocity', 'z-angular velocity']

        plt.plot(np.linspace(0, num_j_values, len(k_values)), k_values, label=f'{k_labels[k_index ]}', color=colors[k_index])

    plt.xlabel('time(s)')
    plt.ylabel('Values')
    plt.legend()
    plt.show()
    