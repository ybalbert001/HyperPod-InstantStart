import { useEffect, useRef, useCallback } from 'react';

// 全局刷新配置
const REFRESH_CONFIG = {
  INTERVAL: 60000, // 60秒，与WebSocket保持一致
  ENABLED: true
};

// 全局刷新管理器
class RefreshManager {
  constructor() {
    this.subscribers = new Map();
    this.interval = null;
    this.isRunning = false;
  }

  // 订阅刷新事件
  subscribe(id, callback) {
    this.subscribers.set(id, callback);
    
    // 如果是第一个订阅者，启动定时器
    if (this.subscribers.size === 1 && REFRESH_CONFIG.ENABLED) {
      this.start();
    }
    
    console.log(`RefreshManager: Subscribed ${id}, total subscribers: ${this.subscribers.size}`);
  }

  // 取消订阅
  unsubscribe(id) {
    this.subscribers.delete(id);
    
    // 如果没有订阅者了，停止定时器
    if (this.subscribers.size === 0) {
      this.stop();
    }
    
    console.log(`RefreshManager: Unsubscribed ${id}, total subscribers: ${this.subscribers.size}`);
  }

  // 启动定时器
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.interval = setInterval(() => {
      console.log(`RefreshManager: Auto-refreshing ${this.subscribers.size} subscribers`);
      this.notifyAll();
    }, REFRESH_CONFIG.INTERVAL);
    
    console.log(`RefreshManager: Started with interval ${REFRESH_CONFIG.INTERVAL}ms`);
  }

  // 停止定时器
  stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.isRunning = false;
    console.log('RefreshManager: Stopped');
  }

  // 通知所有订阅者
  notifyAll() {
    this.subscribers.forEach((callback, id) => {
      try {
        callback();
      } catch (error) {
        console.error(`RefreshManager: Error calling callback for ${id}:`, error);
      }
    });
  }

  // 手动触发刷新
  triggerRefresh() {
    console.log(`RefreshManager: Manual refresh triggered for ${this.subscribers.size} subscribers`);
    this.notifyAll();
  }

  // 获取配置
  getConfig() {
    return { ...REFRESH_CONFIG };
  }

  // 更新配置
  updateConfig(newConfig) {
    const oldInterval = REFRESH_CONFIG.INTERVAL;
    Object.assign(REFRESH_CONFIG, newConfig);
    
    // 如果间隔时间改变了，重启定时器
    if (oldInterval !== REFRESH_CONFIG.INTERVAL && this.isRunning) {
      this.stop();
      this.start();
    }
    
    console.log('RefreshManager: Config updated', REFRESH_CONFIG);
  }
}

// 全局实例
const refreshManager = new RefreshManager();

// 自定义Hook
export const useAutoRefresh = (id, refreshCallback, options = {}) => {
  const { 
    enabled = true, 
    immediate = true 
  } = options;
  
  const callbackRef = useRef(refreshCallback);
  const enabledRef = useRef(enabled);
  
  // 更新回调引用
  useEffect(() => {
    callbackRef.current = refreshCallback;
  }, [refreshCallback]);
  
  // 更新启用状态
  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  
  // 包装的回调函数，检查是否启用
  const wrappedCallback = useCallback(() => {
    if (enabledRef.current && callbackRef.current) {
      callbackRef.current();
    }
  }, []);
  
  // 手动刷新函数
  const manualRefresh = useCallback(() => {
    if (callbackRef.current) {
      callbackRef.current();
    }
  }, []);
  
  useEffect(() => {
    if (!enabled) return;
    
    // 订阅自动刷新
    refreshManager.subscribe(id, wrappedCallback);
    
    // 立即执行一次（如果需要）
    if (immediate && refreshCallback) {
      refreshCallback();
    }
    
    return () => {
      refreshManager.unsubscribe(id);
    };
  }, [id, enabled, immediate, wrappedCallback]);
  
  return {
    manualRefresh,
    refreshManager,
    config: refreshManager.getConfig()
  };
};

// 导出刷新管理器实例，供其他组件使用
export { refreshManager };
export default useAutoRefresh;
