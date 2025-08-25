/**
 * 自动刷新配置查看工具
 * 用于查看和调试刷新相关的配置
 */

import globalRefreshManager from '../hooks/useGlobalRefresh';
import { REFRESH_CONFIG } from '../config/refreshConfig';

export class RefreshConfigViewer {
  /**
   * 显示当前的自动刷新配置
   */
  static showAutoRefreshConfig() {
    console.group('🔄 Auto Refresh Configuration');
    
    const config = REFRESH_CONFIG.DEFAULT;
    
    console.log('📋 Default Settings:');
    console.log(`  ⏰ Auto Refresh Interval: ${config.autoRefreshInterval}ms (${config.autoRefreshInterval / 1000}s)`);
    console.log(`  🔄 Auto Refresh Enabled by Default: ${config.autoRefreshEnabled}`);
    console.log(`  🚀 Max Concurrent Refresh: ${config.maxConcurrentRefresh}`);
    console.log(`  ⏱️ Refresh Timeout: ${config.refreshTimeout}ms (${config.refreshTimeout / 1000}s)`);
    console.log(`  🔁 Retry Attempts: ${config.retryAttempts}`);
    console.log(`  📢 Show Notifications: ${config.showRefreshNotifications}`);
    console.log(`  🐛 Debug Logs: ${config.enableDebugLogs}`);
    
    console.groupEnd();
    
    return config;
  }

  /**
   * 显示组件优先级配置
   */
  static showComponentPriorities() {
    console.group('📊 Component Priorities');
    
    const priorities = REFRESH_CONFIG.COMPONENT_PRIORITIES;
    
    // 按优先级排序
    const sortedPriorities = Object.entries(priorities)
      .sort(([,a], [,b]) => b - a);
    
    console.log('🏆 Priority Ranking (Higher = More Important):');
    sortedPriorities.forEach(([component, priority], index) => {
      const emoji = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : '📋';
      console.log(`  ${emoji} ${component}: ${priority}`);
    });
    
    console.groupEnd();
    
    return priorities;
  }

  /**
   * 显示当前运行时状态
   */
  static showRuntimeStatus() {
    console.group('⚡ Runtime Status');
    
    const stats = globalRefreshManager.getRefreshStats();
    
    console.log('📊 Current Status:');
    console.log(`  🔄 Auto Refresh Active: ${stats.autoRefreshEnabled || false}`);
    console.log(`  ⏰ Current Interval: ${stats.autoRefreshInterval || 'N/A'}ms`);
    console.log(`  📋 Registered Components: ${stats.subscriberCount || 0}`);
    console.log(`  🔄 Is Currently Refreshing: ${stats.isRefreshing || false}`);
    console.log(`  ⏱️ Last Refresh: ${stats.lastRefreshTime ? new Date(stats.lastRefreshTime).toLocaleTimeString() : 'Never'}`);
    console.log(`  📈 Total Refreshes: ${stats.totalRefreshes || 0}`);
    
    if (stats.subscribers && stats.subscribers.length > 0) {
      console.log('📋 Registered Components:');
      stats.subscribers.forEach(componentId => {
        const priority = REFRESH_CONFIG.COMPONENT_PRIORITIES[componentId] || 0;
        console.log(`  • ${componentId} (priority: ${priority})`);
      });
    }
    
    console.groupEnd();
    
    return stats;
  }

  /**
   * 显示操作刷新配置
   */
  static showOperationRefreshConfig() {
    console.group('🎯 Operation Refresh Configuration');
    
    const operations = REFRESH_CONFIG.OPERATION_REFRESH_CONFIG;
    
    console.log('🚀 Configured Operations:');
    Object.entries(operations).forEach(([operation, config]) => {
      console.log(`\n📌 ${operation}:`);
      console.log(`  ⚡ Immediate: [${config.immediate.join(', ')}]`);
      if (config.delayed && config.delayed.length > 0) {
        console.log(`  ⏰ Delayed:`);
        config.delayed.forEach(delay => {
          console.log(`    • ${delay.components.join(', ')} after ${delay.delay}ms`);
        });
      }
    });
    
    console.groupEnd();
    
    return operations;
  }

  /**
   * 显示完整的刷新配置概览
   */
  static showFullConfiguration() {
    console.group('🎛️ Complete Refresh Configuration Overview');
    
    console.log('🚀 Starting configuration overview...\n');
    
    const results = {
      autoRefresh: this.showAutoRefreshConfig(),
      priorities: this.showComponentPriorities(),
      runtime: this.showRuntimeStatus(),
      operations: this.showOperationRefreshConfig()
    };
    
    console.log('\n✅ Configuration overview complete!');
    console.groupEnd();
    
    return results;
  }

  /**
   * 计算不同间隔的刷新频率
   */
  static calculateRefreshFrequencies() {
    console.group('📊 Refresh Frequency Analysis');
    
    const intervals = [30000, 60000, 120000, 300000]; // 30s, 1m, 2m, 5m
    
    console.log('⏰ Refresh Frequencies:');
    intervals.forEach(interval => {
      const seconds = interval / 1000;
      const minutes = seconds / 60;
      const refreshesPerHour = 3600 / seconds;
      
      console.log(`  • ${interval}ms (${seconds}s / ${minutes}m): ${refreshesPerHour.toFixed(1)} refreshes/hour`);
    });
    
    const currentInterval = REFRESH_CONFIG.DEFAULT.autoRefreshInterval;
    const currentFrequency = 3600 / (currentInterval / 1000);
    
    console.log(`\n🎯 Current Setting: ${currentInterval}ms = ${currentFrequency.toFixed(1)} refreshes/hour`);
    
    console.groupEnd();
    
    return {
      currentInterval,
      currentFrequency,
      alternatives: intervals.map(interval => ({
        interval,
        seconds: interval / 1000,
        minutes: interval / 60000,
        refreshesPerHour: 3600 / (interval / 1000)
      }))
    };
  }

  /**
   * 测试不同的自动刷新间隔
   */
  static testAutoRefreshInterval(intervalMs) {
    console.group(`🧪 Testing Auto Refresh with ${intervalMs}ms interval`);
    
    console.log(`🚀 Setting auto refresh interval to ${intervalMs}ms (${intervalMs/1000}s)`);
    
    // 启用自动刷新
    globalRefreshManager.setAutoRefresh(true, intervalMs);
    
    console.log('✅ Auto refresh enabled with new interval');
    console.log('⏰ Monitor the console for refresh activity');
    console.log('🛑 Use globalRefreshManager.setAutoRefresh(false) to stop');
    
    console.groupEnd();
    
    return {
      interval: intervalMs,
      enabled: true,
      message: `Auto refresh set to ${intervalMs}ms`
    };
  }
}

// 开发环境下暴露到window对象
if (process.env.NODE_ENV === 'development') {
  window.RefreshConfigViewer = RefreshConfigViewer;
  window.showAutoRefreshConfig = RefreshConfigViewer.showAutoRefreshConfig;
  window.showRuntimeStatus = RefreshConfigViewer.showRuntimeStatus;
  window.showFullConfiguration = RefreshConfigViewer.showFullConfiguration;
  window.calculateRefreshFrequencies = RefreshConfigViewer.calculateRefreshFrequencies;
  window.testAutoRefreshInterval = RefreshConfigViewer.testAutoRefreshInterval;
}

export default RefreshConfigViewer;
