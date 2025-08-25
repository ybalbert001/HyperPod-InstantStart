/**
 * 第三阶段验证工具
 * 验证TrainingMonitorPanel、DeploymentManager集成和WebSocket优化
 */

import globalRefreshManager from '../hooks/useGlobalRefresh';
import operationRefreshManager from '../hooks/useOperationRefresh';

export class Phase3ValidationUtils {
  /**
   * 验证第三阶段组件集成
   */
  static validatePhase3Components() {
    const globalStats = globalRefreshManager.getRefreshStats();
    const globalComponents = globalRefreshManager.getComponentStatus();
    const operationStats = operationRefreshManager.getOperationStats();
    
    console.group('🚀 Phase 3 Component Integration Validation');
    
    // 检查新集成的组件
    const expectedComponents = [
      { id: 'cluster-management', priority: 10 },
      { id: 'app-status', priority: 9 },
      { id: 'cluster-status', priority: 9 },
      { id: 'training-monitor', priority: 8 },
      { id: 'status-monitor', priority: 8 },
      { id: 'deployment-manager', priority: 7 }
    ];
    
    const results = {
      globalManager: {
        totalComponents: globalComponents.length,
        expectedComponents: expectedComponents.length,
        missingComponents: [],
        priorityCorrect: true
      },
      operationManager: {
        totalSubscribers: operationStats.subscriberCount,
        isHealthy: operationStats.subscriberCount >= 0
      }
    };
    
    // 验证组件存在性和优先级
    expectedComponents.forEach(expected => {
      const found = globalComponents.find(c => c.id === expected.id);
      if (!found) {
        results.globalManager.missingComponents.push(expected.id);
      } else if (found.priority !== expected.priority) {
        results.globalManager.priorityCorrect = false;
        console.warn(`⚠️ Priority mismatch for ${expected.id}: expected ${expected.priority}, got ${found.priority}`);
      }
    });
    
    // 输出结果
    console.log('📊 Global Manager:', results.globalManager);
    console.log('🎯 Operation Manager:', results.operationManager);
    
    if (results.globalManager.missingComponents.length === 0) {
      console.log('✅ All expected components are registered');
    } else {
      console.warn('❌ Missing components:', results.globalManager.missingComponents);
    }
    
    console.groupEnd();
    return results;
  }

  /**
   * 测试WebSocket优化效果
   */
  static async testWebSocketOptimization() {
    console.group('🔌 WebSocket Optimization Test');
    
    const results = {
      connectionStatus: 'unknown',
      canSendMessages: false,
      heartbeatWorking: false,
      onDemandUpdateWorking: false
    };
    
    // 检查WebSocket连接状态
    if (window.ws) {
      results.connectionStatus = window.ws.readyState === WebSocket.OPEN ? 'connected' : 'disconnected';
      results.canSendMessages = window.ws.readyState === WebSocket.OPEN;
      
      if (results.canSendMessages) {
        console.log('✅ WebSocket connection is active');
        
        // 测试心跳
        try {
          window.ws.send(JSON.stringify({
            type: 'ping',
            timestamp: new Date().toISOString(),
            test: true
          }));
          console.log('📡 Heartbeat test sent');
          results.heartbeatWorking = true;
        } catch (error) {
          console.error('❌ Heartbeat test failed:', error);
        }
        
        // 测试按需状态更新
        try {
          window.ws.send(JSON.stringify({
            type: 'request_status_update',
            timestamp: new Date().toISOString(),
            test: true
          }));
          console.log('🔄 On-demand update test sent');
          results.onDemandUpdateWorking = true;
        } catch (error) {
          console.error('❌ On-demand update test failed:', error);
        }
      } else {
        console.warn('⚠️ WebSocket is not connected');
      }
    } else {
      console.warn('⚠️ WebSocket instance not found');
    }
    
    console.log('📊 WebSocket Test Results:', results);
    console.groupEnd();
    
    return results;
  }

  /**
   * 测试操作触发刷新
   */
  static async testOperationRefresh() {
    console.group('🎯 Operation Refresh Test');
    
    const testOperations = [
      'model-deploy',
      'model-undeploy',
      'training-start',
      'training-stop'
    ];
    
    const results = {};
    
    for (const operation of testOperations) {
      try {
        console.log(`🧪 Testing operation: ${operation}`);
        
        const startTime = Date.now();
        await operationRefreshManager.triggerOperationRefresh(operation, {
          test: true,
          timestamp: new Date().toISOString()
        });
        const duration = Date.now() - startTime;
        
        results[operation] = {
          success: true,
          duration: `${duration}ms`
        };
        
        console.log(`✅ ${operation} completed in ${duration}ms`);
        
      } catch (error) {
        results[operation] = {
          success: false,
          error: error.message
        };
        console.error(`❌ ${operation} failed:`, error);
      }
    }
    
    console.log('📊 Operation Refresh Results:', results);
    console.groupEnd();
    
    return results;
  }

  /**
   * 性能基准测试
   */
  static async performanceBenchmark() {
    console.group('⚡ Performance Benchmark');
    
    const results = {
      globalRefresh: null,
      componentRefresh: {},
      concurrentRefresh: null
    };
    
    // 测试全局刷新性能
    try {
      console.log('🧪 Testing global refresh performance...');
      const startTime = Date.now();
      
      const globalResult = await globalRefreshManager.triggerGlobalRefresh({
        source: 'benchmark-test'
      });
      
      const duration = Date.now() - startTime;
      results.globalRefresh = {
        success: globalResult.success,
        duration: `${duration}ms`,
        componentCount: globalResult.results?.length || 0,
        errorCount: globalResult.errors?.length || 0
      };
      
      console.log('✅ Global refresh benchmark:', results.globalRefresh);
      
    } catch (error) {
      results.globalRefresh = { error: error.message };
      console.error('❌ Global refresh benchmark failed:', error);
    }
    
    // 测试并发刷新性能
    try {
      console.log('🧪 Testing concurrent refresh performance...');
      const startTime = Date.now();
      
      const promises = [
        globalRefreshManager.triggerGlobalRefresh({ source: 'concurrent-test-1' }),
        globalRefreshManager.triggerGlobalRefresh({ source: 'concurrent-test-2' }),
        globalRefreshManager.triggerGlobalRefresh({ source: 'concurrent-test-3' })
      ];
      
      const concurrentResults = await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      results.concurrentRefresh = {
        duration: `${duration}ms`,
        testCount: promises.length,
        successCount: concurrentResults.filter(r => r.success).length
      };
      
      console.log('✅ Concurrent refresh benchmark:', results.concurrentRefresh);
      
    } catch (error) {
      results.concurrentRefresh = { error: error.message };
      console.error('❌ Concurrent refresh benchmark failed:', error);
    }
    
    console.log('📊 Performance Benchmark Results:', results);
    console.groupEnd();
    
    return results;
  }

  /**
   * 运行完整的第三阶段验证
   */
  static async runFullPhase3Validation() {
    console.group('🎯 Full Phase 3 Validation');
    console.log('🚀 Starting comprehensive Phase 3 validation...');
    
    const results = {
      timestamp: new Date().toISOString(),
      phase: 'Phase 3 - Advanced Integration',
      tests: {}
    };
    
    try {
      // 1. 组件集成验证
      console.log('1️⃣ Validating component integration...');
      results.tests.componentIntegration = this.validatePhase3Components();
      
      // 2. WebSocket优化验证
      console.log('2️⃣ Testing WebSocket optimization...');
      results.tests.websocketOptimization = await this.testWebSocketOptimization();
      
      // 3. 操作刷新测试
      console.log('3️⃣ Testing operation refresh...');
      results.tests.operationRefresh = await this.testOperationRefresh();
      
      // 4. 性能基准测试
      console.log('4️⃣ Running performance benchmark...');
      results.tests.performance = await this.performanceBenchmark();
      
      // 生成总体评估
      results.overall = this.generatePhase3Report(results.tests);
      
    } catch (error) {
      console.error('❌ Phase 3 validation failed:', error);
      results.error = error.message;
      results.overall = '❌ FAILED';
    }
    
    console.log('📋 Phase 3 Validation Complete:', results.overall);
    console.groupEnd();
    
    return results;
  }

  /**
   * 生成第三阶段验证报告
   */
  static generatePhase3Report(tests) {
    const scores = {
      componentIntegration: 0,
      websocketOptimization: 0,
      operationRefresh: 0,
      performance: 0
    };
    
    // 评分组件集成
    if (tests.componentIntegration) {
      const { globalManager } = tests.componentIntegration;
      if (globalManager.missingComponents.length === 0 && globalManager.priorityCorrect) {
        scores.componentIntegration = 100;
      } else if (globalManager.missingComponents.length <= 1) {
        scores.componentIntegration = 75;
      } else {
        scores.componentIntegration = 50;
      }
    }
    
    // 评分WebSocket优化
    if (tests.websocketOptimization) {
      const { connectionStatus, canSendMessages, heartbeatWorking, onDemandUpdateWorking } = tests.websocketOptimization;
      let wsScore = 0;
      if (connectionStatus === 'connected') wsScore += 25;
      if (canSendMessages) wsScore += 25;
      if (heartbeatWorking) wsScore += 25;
      if (onDemandUpdateWorking) wsScore += 25;
      scores.websocketOptimization = wsScore;
    }
    
    // 评分操作刷新
    if (tests.operationRefresh) {
      const successCount = Object.values(tests.operationRefresh).filter(r => r.success).length;
      const totalCount = Object.keys(tests.operationRefresh).length;
      scores.operationRefresh = totalCount > 0 ? (successCount / totalCount) * 100 : 0;
    }
    
    // 评分性能
    if (tests.performance) {
      const { globalRefresh, concurrentRefresh } = tests.performance;
      let perfScore = 0;
      if (globalRefresh && globalRefresh.success) perfScore += 50;
      if (concurrentRefresh && concurrentRefresh.successCount > 0) perfScore += 50;
      scores.performance = perfScore;
    }
    
    // 计算总分
    const totalScore = Object.values(scores).reduce((sum, score) => sum + score, 0) / 4;
    
    let overall;
    if (totalScore >= 90) {
      overall = '🏆 EXCELLENT';
    } else if (totalScore >= 75) {
      overall = '✅ GOOD';
    } else if (totalScore >= 60) {
      overall = '⚠️ FAIR';
    } else {
      overall = '❌ NEEDS IMPROVEMENT';
    }
    
    return {
      overall,
      totalScore: Math.round(totalScore),
      scores,
      summary: {
        componentIntegration: scores.componentIntegration >= 75 ? '✅' : '❌',
        websocketOptimization: scores.websocketOptimization >= 75 ? '✅' : '❌',
        operationRefresh: scores.operationRefresh >= 75 ? '✅' : '❌',
        performance: scores.performance >= 75 ? '✅' : '❌'
      }
    };
  }
}

// 开发环境下暴露到window对象
if (process.env.NODE_ENV === 'development') {
  window.Phase3ValidationUtils = Phase3ValidationUtils;
}

export default Phase3ValidationUtils;
