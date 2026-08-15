import os
import numpy as np
import csv
import math

def store_csv_file(data, timestamps, file_name):
    output_dir = os.path.join('..', 'data', 'processed')
    os.makedirs(output_dir, exist_ok=True)  # 🔧 確保資料夾存在
    count = 1
    for timestamp in timestamps:
        file_name = file_name.replace('.txt', '')
        file_path = os.path.join(file_name + '_' + str(count) + '.csv')
        with open('../data/processed/' + file_path, 'w', newline='') as csvfile:
            writer = csv.writer(csvfile, delimiter=',')
            for t in range(int(timestamp / 10) - 50, int(timestamp / 10) + 75):
                writer.writerow(data[t][:])
            count += 1


folder_path = "C:/Users/gordo/AI-badminton/data/origin"
for file_name in os.listdir(folder_path):
    file_path = os.path.join(folder_path, file_name)
    with open(file_path, 'r') as file:
        count = 0
        lines = file.readlines()
        data = []
        for line in lines:
            values = line.strip().split(',')
            values.remove(values[4])
            data.append([float(value) for value in values])
        data = np.array(data)

        sum = 0
        max = 0
        for i in range(0, len(data[:,1])):
            avg = (math.pow(data[i][4], 2) + math.pow(data[i][5], 2) + math.pow(data[i][6], 2)) ** 0.5
            if avg > max:
                max = avg
            sum += avg
        std = 0.7 * (sum / len(data[:,1])) + 0.3 * max
        #print(file_name, avg)
        
        timestamps = []
        time = 0
        while time < len(data[:,1]) - 149:
            value = (math.pow(data[time][4], 2) + math.pow(data[time][5], 2) + math.pow(data[time][6], 2)) ** 0.5
            if value > std:
                max = value
                timestamp = time
                j = time + 1
                while j < time + 10:
                    value = (math.pow(data[j][4], 2) + math.pow(data[j][5], 2) + math.pow(data[j][6], 2)) ** 0.5
                    if value > max:
                        max = value
                        timestamp = j
                    j += 1
                timestamps.append(timestamp * 10)
                count += 1
                time = timestamp + 150
            time += 1
        print(file_name,count)
        #print(timestamps) 
        store_csv_file(data, timestamps, file_name)
       