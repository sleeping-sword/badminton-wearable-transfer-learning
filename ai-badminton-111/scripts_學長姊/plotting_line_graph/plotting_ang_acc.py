#draw three axes angular acceleration 
import os
import numpy as np
import matplotlib.pyplot as plt

folder_path = "../../data/processed"
start_draw_timestamp = 0

for file_name in os.listdir(folder_path):
    file_path = os.path.join(folder_path, file_name)
    with open(file_path, 'r') as file:
        lines = file.readlines()
        
        data = []
        for line in lines:
            values = line.strip().split(',')
            #values.remove(values[4]) #for dataset
            data.append([float(value) for value in values])
        
        data = np.array(data)
        #print(data)

        colors = ['green', 'purple', 'brown']
        #以秒為單位(因為1秒收集100次)
        num_j_values = data.shape[0] / 100

        for k_index in range(4,data.shape[1]):
            k_values = data[start_draw_timestamp:, k_index]
            k_labels = ['x-angular velocity', 'y-angular velocity', 'z-angular velocity']

            plt.plot(np.linspace(0, num_j_values, len(k_values)), k_values, label=f'{k_labels[k_index - 4]}', color=colors[k_index - 4])

        plt.xlabel('time(s)')
        plt.ylabel('Values')
        plt.title(f'{file_name}')
        plt.legend()
        plt.show()
        