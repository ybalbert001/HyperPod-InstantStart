/**
 * 操作触发刷新管理器
 * 在用户执行操作后智能触发相关组件的刷新
 * 
 * 功能特性：
 * - 立即反馈：操作后立即刷新相关状态
 * - 分层刷新：根据操作类型决定刷新范围和时机
 * - 智能延迟：根据操作特性设置合理的延迟刷新
 * - 事件系统：支持操作事件的监听和处理
 */

import { getOperationRefreshConfig, getRefreshConfig } from '../config/refreshConfig';
import globalRefreshManager from './useGlobalRefresh';

class OperationRefreshManager {
  constructor() {
    this.refreshSubscribers = new Map();
    this.operationConfig = getOperationRefreshConfig() || {};
    this.debugConfig = getRefreshConfig('DEBUG');
    this.eventListeners = new Map();
    this.activeOperations = new Map();
    
    if (this.debugConfig.enableRefreshTracing) {
      console.log('OperationRefreshManager initialized');
    }
  }

  /**
   * 注册刷新回调
   * @param {string} componentId - 组件ID
   * @param {Function} refreshCallback - 刷新回调函数
   */
  subscribe(componentId, refreshCallback) {
    this.refreshSubscribers.set(componentId, refreshCallback);
    
    if (this.debugConfig.enableRefreshTracing) {
      console.log(`Component '${componentId}' subscribed to operation refresh`);
    }
  }

  /**
   * 取消订阅
   * @param {string} componentId - 组件ID
   */
  unsubscribe(componentId) {
    if (this.refreshSubscribers.has(componentId)) {
      this.refreshSubscribers.delete(componentId);
      
      if (this.debugConfig.enableRefreshTracing) {
        console.log(`Component '${componentId}' unsubscribed from operation refresh`);
      }
    }
  }

  /**
   * 添加事件监听器
   * @param {string} eventType - 事件类型
   * @param {Function} listener - 监听器函数
   */
  on(eventType, listener) {
    if (!this.eventListeners.has(eventType)) {
      this.eventListeners.set(eventType, []);
    }
    this.eventListeners.get(eventType).push(listener);
  }

  /**
   * 移除事件监听器
   * @param {string} eventType - 事件类型
   * @param {Function} listener - 监听器函数
   */
  off(eventType, listener) {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * 触发事件
   * @param {string} eventType - 事件类型
   * @param {*} data - 事件数据
   */
  emit(eventType, data) {
    const listeners = this.eventListeners.get(eventType);
    if (listeners) {
      listeners.forEach(listener => {
        try {
          listener(data);
        } catch (error) {
          console.error(`Error in event listener for ${eventType}:`, error);
        }
      });
    }
  }

  /**
   * 触发操作后刷新
   * @param {string} operationType - 操作类型
   * @param {Object} operationData - 操作数据
   */
  async triggerOperationRefresh(operationType, operationData = {}) {
    const config = this.operationConfig[operationType];
    if (!config) {
      if (this.debugConfig.enableRefreshTracing) {
        console.warn(`No refresh config found for operation: ${operationType}`);
      }
      return;
    }

    const operationId = `${operationType}-${Date.now()}`;
    
    if (this.debugConfig.enableRefreshTracing) {
      console.log(`🎯 Triggering refresh for operation: ${operationType}`, operationData);
    }

    // 记录活跃操作
    this.activeOperations.set(operationId, {
      type: operationType,
      data: operationData,
      startTime: Date.now(),
      status: 'running'
    });

    // 触发操作开始事件
    this.emit('operation-start', { operationId, operationType, operationData });

    try {
      // 立即刷新
      if (config.immediate && config.immediate.length > 0) {
        await this.executeRefresh(config.immediate, 'immediate', operationType);
      }

      // 延迟刷新
      if (config.delayed && config.delayed.length > 0) {
        config.delayed.forEach(({ components, delay }) => {
          setTimeout(async () => {
            try {
              await this.executeRefresh(components, `delayed-${delay}ms`, operationType);
            } catch (error) {
              console.error(`Delayed refresh failed for ${operationType}:`, error);
            }
          }, delay);
        });
      }

      // 更新操作状态
      const operation = this.activeOperations.get(operationId);
      if (operation) {
        operation.status = 'completed';
        operation.endTime = Date.now();
      }

      // 触发操作完成事件
      this.emit('operation-complete', { operationId, operationType, operationData });

    } catch (error) {
      console.error(`Operation refresh failed for ${operationType}:`, error);
      
      // 更新操作状态
      const operation = this.activeOperations.get(operationId);
      if (operation) {
        operation.status = 'failed';
        operation.error = error.message;
        operation.endTime = Date.now();
      }

      // 触发操作失败事件
      this.emit('operation-error', { operationId, operationType, operationData, error });
    }

    // 清理过期的操作记录（5分钟后）
    setTimeout(() => {
      this.activeOperations.delete(operationId);
    }, 5 * 60 * 1000);
  }

  /**
   * 执行刷新
   * @param {Array} components - 要刷新的组件列表
   * @param {string} refreshType - 刷新类型
   * @param {string} operationType - 操作类型
   */
  async executeRefresh(components, refreshType, operationType) {
    if (this.debugConfig.enableRefreshTracing) {
      console.log(`🔄 Executing ${refreshType} refresh for ${operationType}:`, components);
    }

    const refreshPromises = [];

    if (components.includes('all')) {
      // 触发全局刷新
      const globalRefreshPromise = globalRefreshManager.triggerGlobalRefresh({
        source: 'operation',
        operationType,
        refreshType
      });
      refreshPromises.push(globalRefreshPromise);
      
    } else {
      // 刷新指定组件
      components.forEach(componentId => {
        const callback = this.refreshSubscribers.get(componentId);
        if (callback) {
          const refreshPromise = callback().catch(error => {
            console.error(`Refresh failed for ${componentId}:`, error);
          });
          refreshPromises.push(refreshPromise);
        } else {
          // 如果组件没有在操作刷新管理器中注册，尝试从全局刷新管理器获取
          const globalSubscriber = globalRefreshManager.subscribers?.get(componentId);
          if (globalSubscriber && globalSubscriber.callback) {
            const refreshPromise = globalSubscriber.callback().catch(error => {
              console.error(`Global refresh failed for ${componentId}:`, error);
            });
            refreshPromises.push(refreshPromise);
          } else if (this.debugConfig.enableRefreshTracing) {
            console.warn(`No refresh callback found for component: ${componentId}`);
          }
        }
      });
    }

    if (refreshPromises.length > 0) {
      const results = await Promise.allSettled(refreshPromises);
      
      if (this.debugConfig.enablePerformanceLogging) {
        const successCount = results.filter(r => r.status === 'fulfilled').length;
        const errorCount = results.filter(r => r.status === 'rejected').length;
        console.log(`${refreshType} refresh completed: ${successCount} success, ${errorCount} errors`);
      }
    }
  }

  /**
   * 获取活跃操作列表
   */
  getActiveOperations() {
    return Array.from(this.activeOperations.entries()).map(([id, operation]) => ({
      id,
      ...operation
    }));
  }

  /**
   * 获取操作统计信息
   */
  getOperationStats() {
    const activeOps = this.getActiveOperations();
    const runningOps = activeOps.filter(op => op.status === 'running');
    const completedOps = activeOps.filter(op => op.status === 'completed');
    const failedOps = activeOps.filter(op => op.status === 'failed');

    return {
      totalOperations: activeOps.length,
      runningOperations: runningOps.length,
      completedOperations: completedOps.length,
      failedOperations: failedOps.length,
      subscriberCount: this.refreshSubscribers.size,
      activeOperations: activeOps
    };
  }

  /**
   * 清理所有活跃操作
   */
  clearActiveOperations() {
    this.activeOperations.clear();
    if (this.debugConfig.enableRefreshTracing) {
      console.log('All active operations cleared');
    }
  }

  /**
   * 销毁管理器
   */
  destroy() {
    this.refreshSubscribers.clear();
    this.eventListeners.clear();
    this.activeOperations.clear();
    
    if (this.debugConfig.enableRefreshTracing) {
      console.log('OperationRefreshManager destroyed');
    }
  }
}

// 创建全局单例实例
const operationRefreshManager = new OperationRefreshManager();

// 开发环境下暴露到window对象，便于调试
if (process.env.NODE_ENV === 'development') {
  window.operationRefreshManager = operationRefreshManager;
}

export default operationRefreshManager;
