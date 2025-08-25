/**
 * 刷新机制验证工具
 * 用于测试和验证全局刷新系统的功能
 */

import globalRefreshManager from '../hooks/useGlobalRefresh';
import operationRefreshManager from '../hooks/useOperationRefresh';

export class RefreshTestUtils {
  /**
   * 验证全局刷新管理器状态
   */
  static validateGlobalRefreshManager() {
    const stats = globalRefreshManager.getRefreshStats();
    const components = globalRefreshManager.getComponentStatus();
    
    console.group('🔄 Global Refresh Manager Status');
    console.log('📊 Statistics:', stats);
    console.log('🧩 Components:', components);
    console.log('✅ Expected High Priority Components:', [
      'cluster-management (10)',
      'app-status (9)', 
      'cluster-status (9)',
      'status-monitor (8)'
    ]);
    console.groupEnd();
    
    return {
      isHealthy: stats.subscriberCount > 0,
      hasHighPriorityComponents: components.some(c => c.priority >= 8),
      stats,
      components
    };
  }

  /**
   * 验证操作刷新管理器状态
   */
  static validateOperationRefreshManager() {
    const stats = operationRefreshManager.getOperationStats();
    
    console.group('🎯 Operation Refresh Manager Status');
    console.log('📊 Statistics:', stats);
    console.groupEnd();
    
    return {
      isHealthy: stats.subscriberCount >= 0,
      stats
    };
  }

  /**
   * 测试全局刷新功能
   */
  static async testGlobalRefresh() {
    console.group('🧪 Testing Global Refresh');
    
    try {
      const startTime = Date.now();
      const result = await globalRefreshManager.triggerGlobalRefresh({
        source: 'test'
      });
      const duration = Date.now() - startTime;
      
      console.log('✅ Global refresh completed:', {
        success: result.success,
        duration: `${duration}ms`,
        results: result.results?.length || 0,
        errors: result.errors?.length || 0
      });
      
      if (result.errors && result.errors.length > 0) {
        console.warn('⚠️ Errors during refresh:', result.errors);
      }
      
      console.groupEnd();
      return result;
      
    } catch (error) {
      console.error('❌ Global refresh test failed:', error);
      console.groupEnd();
      throw error;
    }
  }

  /**
   * 测试操作触发刷新
   */
  static async testOperationRefresh(operationType = 'cluster-launch') {
    console.group(`🎯 Testing Operation Refresh: ${operationType}`);
    
    try {
      await operationRefreshManager.triggerOperationRefresh(operationType, {
        test: true,
        timestamp: new Date().toISOString()
      });
      
      console.log('✅ Operation refresh triggered successfully');
      console.groupEnd();
      
    } catch (error) {
      console.error('❌ Operation refresh test failed:', error);
      console.groupEnd();
      throw error;
    }
  }

  /**
   * 运行完整的刷新系统验证
   */
  static async runFullValidation() {
    console.group('🔍 Full Refresh System Validation');
    
    const results = {
      globalManager: this.validateGlobalRefreshManager(),
      operationManager: this.validateOperationRefreshManager(),
      globalRefreshTest: null,
      operationRefreshTest: null
    };
    
    try {
      // 测试全局刷新
      results.globalRefreshTest = await this.testGlobalRefresh();
      
      // 测试操作刷新
      await this.testOperationRefresh();
      results.operationRefreshTest = { success: true };
      
    } catch (error) {
      console.error('❌ Validation failed:', error);
      results.error = error.message;
    }
    
    // 生成验证报告
    const report = this.generateValidationReport(results);
    console.log('📋 Validation Report:', report);
    
    console.groupEnd();
    return results;
  }

  /**
   * 生成验证报告
   */
  static generateValidationReport(results) {
    const { globalManager, operationManager, globalRefreshTest } = results;
    
    const report = {
      overall: 'UNKNOWN',
      details: {
        globalManagerHealth: globalManager.isHealthy ? '✅ Healthy' : '❌ Unhealthy',
        componentCount: globalManager.stats.subscriberCount,
        highPriorityComponents: globalManager.hasHighPriorityComponents ? '✅ Present' : '❌ Missing',
        globalRefreshWorking: globalRefreshTest?.success ? '✅ Working' : '❌ Failed',
        operationManagerHealth: operationManager.isHealthy ? '✅ Healthy' : '❌ Unhealthy'
      }
    };
    
    // 计算总体状态
    const healthChecks = [
      globalManager.isHealthy,
      globalManager.hasHighPriorityComponents,
      globalRefreshTest?.success,
      operationManager.isHealthy
    ];
    
    const healthyCount = healthChecks.filter(Boolean).length;
    const totalChecks = healthChecks.length;
    
    if (healthyCount === totalChecks) {
      report.overall = '✅ EXCELLENT';
    } else if (healthyCount >= totalChecks * 0.75) {
      report.overall = '⚠️ GOOD';
    } else if (healthyCount >= totalChecks * 0.5) {
      report.overall = '⚠️ FAIR';
    } else {
      report.overall = '❌ POOR';
    }
    
    return report;
  }

  /**
   * 监控刷新性能
   */
  static startPerformanceMonitoring(duration = 60000) {
    console.log(`📊 Starting refresh performance monitoring for ${duration/1000}s...`);
    
    const startTime = Date.now();
    const initialStats = globalRefreshManager.getRefreshStats();
    
    setTimeout(() => {
      const endStats = globalRefreshManager.getRefreshStats();
      const refreshCount = endStats.totalRefreshes - initialStats.totalRefreshes;
      const avgDuration = endStats.averageDuration;
      
      console.group('📊 Performance Monitoring Results');
      console.log(`⏱️ Monitoring Duration: ${duration/1000}s`);
      console.log(`🔄 Refreshes During Period: ${refreshCount}`);
      console.log(`⚡ Average Refresh Duration: ${avgDuration}ms`);
      console.log(`📈 Success Rate: ${endStats.successRate}%`);
      console.groupEnd();
      
    }, duration);
  }
}

// 开发环境下暴露到window对象
if (process.env.NODE_ENV === 'development') {
  window.RefreshTestUtils = RefreshTestUtils;
}

export default RefreshTestUtils;
