// src/services/syncService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AttendanceRecord } from '../types/index';

const QUEUE_KEY = 'workforce_sync_queue';

export const syncService = {

  enqueue: async (record: AttendanceRecord) => {
    const queue = await syncService.getQueue();
    const existingIdx = queue.findIndex(r => r.id === record.id);
    if (existingIdx > -1) {
      queue[existingIdx] = record;
    } else {
      queue.push(record);
    }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  },

  getQueue: async (): Promise<AttendanceRecord[]> => {
    try {
      const data = await AsyncStorage.getItem(QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  },

  saveQueue: async (queue: AttendanceRecord[]) => {
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  },

  clearQueue: async () => {
    await AsyncStorage.removeItem(QUEUE_KEY);
  }
};
