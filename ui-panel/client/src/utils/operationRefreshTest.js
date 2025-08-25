/**
 * 操作刷新测试工具
 * 用于测试模型下载和训练启动的自动刷新功能
 */

import operationRefreshManager from '../hooks/useOperationRefresh';

export class OperationRefreshTest {
  /**
   * 测试模型下载操作刷新
   */
  static async testModelDownloadRefresh() {
    console.group('🧪 Testing Model Download Operation Refresh');
    
    try {
      console.log('🚀 Triggering model-download operation refresh...');
      
      const result = await operationRefreshManager.triggerOperationRefresh('model-download', {
        modelId: 'test-model',
        timestamp: new Date().toISOString(),
        source: 'test'
      });
      
      console.log('✅ Model download refresh result:', result);
      
      // 检查是否触发了正确的组件
      const expectedComponents = ['status-monitor', 'app-status'];
      const triggeredComponents = result.immediate?.results?.map(r => r.componentId) || [];
      
      const success = expectedComponents.every(comp => triggeredComponents.includes(comp));
      
      if (success) {
        console.log('✅ All expected components were refreshed:', triggeredComponents);
      } else {
        console.warn('⚠️ Some expected components were not refreshed');
        console.log('Expected:', expectedComponents);
        console.log('Triggered:', triggeredComponents);
      }
      
      return { success, triggeredComponents, expectedComponents };
      
    } catch (error) {
      console.error('❌ Model download refresh test failed:', error);
      return { success: false, error: error.message };
    } finally {
      console.groupEnd();
    }
  }

  /**
   * 测试训练启动操作刷新
   */
  static async testTrainingStartRefresh() {
    console.group('🧪 Testing Training Start Operation Refresh');
    
    try {
      console.log('🚀 Triggering training-start operation refresh...');
      
      const result = await operationRefreshManager.triggerOperationRefresh('training-start', {
        jobName: 'test-training-job',
        timestamp: new Date().toISOString(),
        source: 'test'
      });
      
      console.log('✅ Training start refresh result:', result);
      
      // 检查是否触发了正确的组件
      const expectedComponents = ['training-monitor', 'status-monitor', 'app-status'];
      const triggeredComponents = result.immediate?.results?.map(r => r.componentId) || [];
      
      const success = expectedComponents.every(comp => triggeredComponents.includes(comp));
      
      if (success) {
        console.log('✅ All expected components were refreshed:', triggeredComponents);
      } else {
        console.warn('⚠️ Some expected components were not refreshed');
        console.log('Expected:', expectedComponents);
        console.log('Triggered:', triggeredComponents);
      }
      
      return { success, triggeredComponents, expectedComponents };
      
    } catch (error) {
      console.error('❌ Training start refresh test failed:', error);
      return { success: false, error: error.message };
    } finally {
      console.groupEnd();
    }
  }

  /**
   * 检查组件注册状态
   */
  static checkComponentRegistrations() {
    console.group('🔍 Checking Component Registrations');
    
    const stats = operationRefreshManager.getOperationStats();
    console.log('📊 Operation Refresh Manager Stats:', stats);
    
    const expectedComponents = [
      'app-status',
      'status-monitor', 
      'training-monitor',
      'deployment-manager',
      'cluster-management'
    ];
    
    const registeredComponents = stats.subscribers || [];
    console.log('📋 Registered components:', registeredComponents);
    
    const missingComponents = expectedComponents.filter(comp => 
      !registeredComponents.includes(comp)
    );
    
    if (missingComponents.length === 0) {
      console.log('✅ All expected components are registered');
    } else {
      console.warn('⚠️ Missing component registrations:', missingComponents);
    }
    
    console.groupEnd();
    
    return {
      expectedComponents,
      registeredComponents,
      missingComponents,
      allRegistered: missingComponents.length === 0
    };
  }

  /**
   * 运行完整的操作刷新测试
   */
  static async runFullOperationRefreshTest() {
    console.group('🎯 Full Operation Refresh Test');
    console.log('🚀 Starting comprehensive operation refresh test...');
    
    const results = {
      timestamp: new Date().toISOString(),
      componentRegistrations: null,
      modelDownloadTest: null,
      trainingStartTest: null,
      overall: 'unknown'
    };
    
    try {
      // 1. 检查组件注册
      console.log('1️⃣ Checking component registrations...');
      results.componentRegistrations = this.checkComponentRegistrations();
      
      // 2. 测试模型下载刷新
      console.log('2️⃣ Testing model download refresh...');
      results.modelDownloadTest = await this.testModelDownloadRefresh();
      
      // 3. 测试训练启动刷新
      console.log('3️⃣ Testing training start refresh...');
      results.trainingStartTest = await this.testTrainingStartRefresh();
      
      // 生成总体评估
      const allTestsPassed = 
        results.componentRegistrations.allRegistered &&
        results.modelDownloadTest.success &&
        results.trainingStartTest.success;
      
      results.overall = allTestsPassed ? '✅ ALL TESTS PASSED' : '⚠️ SOME TESTS FAILED';
      
    } catch (error) {
      console.error('❌ Operation refresh test failed:', error);
      results.error = error.message;
      results.overall = '❌ TEST FAILED';
    }
    
    console.log('📋 Operation Refresh Test Complete:', results.overall);
    console.groupEnd();
    
    return results;
  }

  /**
   * 模拟WebSocket消息触发操作刷新
   */
  static simulateWebSocketOperations() {
    console.group('📡 Simulating WebSocket Operations');
    
    const operations = [
      {
        type: 'model_download',
        status: 'success',
        message: 'Model download completed',
        modelId: 'test-model'
      },
      {
        type: 'training_launch', 
        status: 'success',
        message: 'Training job launched',
        jobName: 'test-job'
      }
    ];
    
    operations.forEach((op, index) => {
      setTimeout(() => {
        console.log(`📨 Simulating WebSocket message ${index + 1}:`, op.type);
        
        // 模拟App.js中的WebSocket消息处理
        if (op.type === 'model_download' && op.status === 'success') {
          operationRefreshManager.triggerOperationRefresh('model-download', op);
        } else if (op.type === 'training_launch' && op.status === 'success') {
          operationRefreshManager.triggerOperationRefresh('training-start', op);
        }
      }, index * 2000); // 每2秒触发一个
    });
    
    console.log('📡 WebSocket simulation started (check console for results)');
    console.groupEnd();
  }
}

// 开发环境下暴露到window对象
if (process.env.NODE_ENV === 'development') {
  window.OperationRefreshTest = OperationRefreshTest;
}

export default OperationRefreshTest;
