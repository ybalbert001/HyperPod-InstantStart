/**
 * 全局刷新管理器
 * 提供统一的刷新控制机制，避免重复API调用和日志污染
 * 
 * 功能特性：
 * - 统一刷新入口
 * - 按需刷新（默认关闭自动刷新）
 * - 智能缓存避免重复调用
 * - 优先级管理
 * - 并发控制
 */

import { getRefreshConfig, getComponentPriority } from '../config/refreshConfig';

class GlobalRefreshManager {
  constructor() {
    this.subscribers = new Map();
    this.isRefreshing = false;
    this.lastRefreshTime = null;
    this.autoRefreshEnabled = false; // 默认关闭自动刷新
    this.autoRefreshInterval = null;
    this.refreshHistory = [];
    this.maxHistorySize = 50;
    
    // 从配置文件加载配置
    this.config = getRefreshConfig('DEFAULT');
    this.componentPriorities = getRefreshConfig('COMPONENT_PRIORITIES');
    this.debugConfig = getRefreshConfig('DEBUG');

    if (this.debugConfig.enableRefreshTracing) {
      console.log('GlobalRefreshManager initialized with config:', this.config);
    }
  }

  /**
   * 订阅刷新事件
   * @param {string} componentId - 组件ID
   * @param {Function} refreshCallback - 刷新回调函数
   * @param {Object} options - 选项配置
   */
  subscribe(componentId, refreshCallback, options = {}) {
    const priority = options.priority || getComponentPriority(componentId);
    
    this.subscribers.set(componentId, {
      callback: refreshCallback,
      lastRefresh: null,
      priority: priority,
      enabled: options.enabled !== false, // 默认启用
      retryCount: 0,
      options: options
    });

    if (this.debugConfig.enableRefreshTracing) {
      console.log(`Component '${componentId}' subscribed to global refresh (priority: ${priority})`);
    }
    return componentId;
  }

  /**
   * 取消订阅
   * @param {string} componentId - 组件ID
   */
  unsubscribe(componentId) {
    if (this.subscribers.has(componentId)) {
      this.subscribers.delete(componentId);
      if (this.debugConfig.enableRefreshTracing) {
        console.log(`Component '${componentId}' unsubscribed from global refresh`);
      }
    }
  }

  /**
   * 启用/禁用特定组件的刷新
   * @param {string} componentId - 组件ID
   * @param {boolean} enabled - 是否启用
   */
  setComponentEnabled(componentId, enabled) {
    const subscriber = this.subscribers.get(componentId);
    if (subscriber) {
      subscriber.enabled = enabled;
      if (this.debugConfig.enableRefreshTracing) {
        console.log(`Component '${componentId}' refresh ${enabled ? 'enabled' : 'disabled'}`);
      }
    }
  }

  /**
   * 全局手动刷新
   * @param {Object} options - 刷新选项
   */
  async triggerGlobalRefresh(options = {}) {
    if (this.isRefreshing && !options.force) {
      if (this.debugConfig.enableRefreshTracing) {
        console.log('Global refresh already in progress, skipping...');
      }
      return { success: false, reason: 'already_refreshing' };
    }

    this.isRefreshing = true;
    const refreshId = Date.now();
    const startTime = new Date();
    
    if (this.debugConfig.enableRefreshTracing) {
      console.log(`🔄 Global refresh started (ID: ${refreshId}) for ${this.subscribers.size} components`);
    }

    const refreshResult = {
      id: refreshId,
      startTime: startTime,
      endTime: null,
      success: true,
      results: [],
      errors: []
    };

    try {
      // 获取启用的订阅者并按优先级排序
      const enabledSubscribers = Array.from(this.subscribers.entries())
        .filter(([id, subscriber]) => subscriber.enabled)
        .sort(([,a], [,b]) => b.priority - a.priority);

      if (this.debugConfig.enableRefreshTracing) {
        console.log(`Refreshing ${enabledSubscribers.length} enabled components:`, 
          enabledSubscribers.map(([id, sub]) => `${id}(${sub.priority})`));
      }

      // 并行执行刷新（考虑并发限制）
      const refreshPromises = enabledSubscribers.map(async ([componentId, subscriber]) => {
        const componentStartTime = Date.now();
        
        try {
          // 设置超时
          const timeoutPromise = new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`Refresh timeout for ${componentId}`)), this.config.refreshTimeout);
          });

          const refreshPromise = subscriber.callback();
          await Promise.race([refreshPromise, timeoutPromise]);

          const duration = Date.now() - componentStartTime;
          subscriber.lastRefresh = new Date();
          subscriber.retryCount = 0;

          const result = {
            componentId,
            success: true,
            duration,
            timestamp: new Date()
          };

          refreshResult.results.push(result);
          
          if (this.debugConfig.enablePerformanceLogging) {
            console.log(`✅ ${componentId} refreshed successfully (${duration}ms)`);
          }
          
          return result;

        } catch (error) {
          const duration = Date.now() - componentStartTime;
          subscriber.retryCount++;

          const errorResult = {
            componentId,
            success: false,
            error: error.message,
            duration,
            timestamp: new Date(),
            retryCount: subscriber.retryCount
          };

          refreshResult.errors.push(errorResult);
          console.error(`❌ ${componentId} refresh failed (${duration}ms):`, error.message);
          
          return errorResult;
        }
      });

      await Promise.allSettled(refreshPromises);

      refreshResult.endTime = new Date();
      refreshResult.totalDuration = refreshResult.endTime - refreshResult.startTime;
      refreshResult.success = refreshResult.errors.length === 0;

      // 记录刷新历史
      this.addRefreshHistory(refreshResult);

      const successCount = refreshResult.results.length;
      const errorCount = refreshResult.errors.length;
      
      if (this.debugConfig.enablePerformanceLogging) {
        console.log(`🏁 Global refresh completed (${refreshResult.totalDuration}ms): ${successCount} success, ${errorCount} errors`);
      }

      this.lastRefreshTime = refreshResult.endTime;
      
      return refreshResult;

    } catch (error) {
      refreshResult.endTime = new Date();
      refreshResult.success = false;
      refreshResult.globalError = error.message;
      
      console.error('❌ Global refresh failed:', error);
      return refreshResult;
      
    } finally {
      this.isRefreshing = false;
    }
  }

  /**
   * 启用/禁用自动刷新
   * @param {boolean} enabled - 是否启用
   * @param {number} interval - 刷新间隔（毫秒）
   */
  setAutoRefresh(enabled, interval = null) {
    this.autoRefreshEnabled = enabled;
    
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
      this.autoRefreshInterval = null;
    }
    
    if (enabled) {
      const refreshInterval = interval || this.config.autoRefreshInterval;
      
      this.autoRefreshInterval = setInterval(async () => {
        if (this.debugConfig.enableRefreshTracing) {
          console.log('🔄 Auto refresh triggered');
        }
        await this.triggerGlobalRefresh({ source: 'auto' });
      }, refreshInterval);
      
      if (this.debugConfig.enableRefreshTracing) {
        console.log(`🔄 Auto refresh enabled (interval: ${refreshInterval}ms)`);
      }
    } else {
      if (this.debugConfig.enableRefreshTracing) {
        console.log('⏸️ Auto refresh disabled');
      }
    }
  }

  /**
   * 添加刷新历史记录
   * @param {Object} refreshResult - 刷新结果
   */
  addRefreshHistory(refreshResult) {
    if (this.debugConfig.logRefreshHistory) {
      this.refreshHistory.unshift(refreshResult);
      
      // 限制历史记录大小
      const maxHistory = this.debugConfig.maxLogHistory || this.maxHistorySize;
      if (this.refreshHistory.length > maxHistory) {
        this.refreshHistory = this.refreshHistory.slice(0, maxHistory);
      }
    }
  }

  /**
   * 获取刷新统计信息
   */
  getRefreshStats() {
    const recentRefreshes = this.refreshHistory.slice(0, 10);
    const totalRefreshes = this.refreshHistory.length;
    const successfulRefreshes = this.refreshHistory.filter(r => r.success).length;
    const averageDuration = totalRefreshes > 0 
      ? this.refreshHistory.reduce((sum, r) => sum + (r.totalDuration || 0), 0) / totalRefreshes 
      : 0;

    return {
      totalRefreshes,
      successfulRefreshes,
      successRate: totalRefreshes > 0 ? (successfulRefreshes / totalRefreshes * 100).toFixed(1) : 0,
      averageDuration: Math.round(averageDuration),
      lastRefreshTime: this.lastRefreshTime,
      isRefreshing: this.isRefreshing,
      autoRefreshEnabled: this.autoRefreshEnabled,
      subscriberCount: this.subscribers.size,
      recentRefreshes,
      config: this.config
    };
  }

  /**
   * 获取组件状态
   */
  getComponentStatus() {
    return Array.from(this.subscribers.entries()).map(([id, subscriber]) => ({
      id,
      enabled: subscriber.enabled,
      priority: subscriber.priority,
      lastRefresh: subscriber.lastRefresh,
      retryCount: subscriber.retryCount
    }));
  }

  /**
   * 重置统计信息
   */
  resetStats() {
    this.refreshHistory = [];
    this.lastRefreshTime = null;
    if (this.debugConfig.enableRefreshTracing) {
      console.log('Refresh statistics reset');
    }
  }

  /**
   * 销毁管理器
   */
  destroy() {
    if (this.autoRefreshInterval) {
      clearInterval(this.autoRefreshInterval);
    }
    
    this.subscribers.clear();
    this.refreshHistory = [];
    if (this.debugConfig.enableRefreshTracing) {
      console.log('GlobalRefreshManager destroyed');
    }
  }
}

// 创建全局单例实例
const globalRefreshManager = new GlobalRefreshManager();

// 开发环境下暴露到window对象，便于调试
if (process.env.NODE_ENV === 'development') {
  window.globalRefreshManager = globalRefreshManager;
}

export default globalRefreshManager;
