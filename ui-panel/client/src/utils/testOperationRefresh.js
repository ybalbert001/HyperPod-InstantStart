/**
 * 简单的操作刷新测试工具
 */

import operationRefreshManager from '../hooks/useOperationRefresh';

// 测试模型下载操作刷新
export const testModelDownloadRefresh = async () => {
  console.group('🧪 Testing Model Download Refresh');
  
  try {
    console.log('🚀 Triggering model-download operation...');
    
    const result = await operationRefreshManager.triggerOperationRefresh('model-download', {
      modelId: 'test-model',
      timestamp: new Date().toISOString(),
      source: 'manual-test'
    });
    
    console.log('✅ Result:', result);
    
    if (result.success) {
      console.log('✅ Model download refresh test PASSED');
    } else {
      console.warn('⚠️ Model download refresh test FAILED');
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  } finally {
    console.groupEnd();
  }
};

// 测试训练启动操作刷新
export const testTrainingStartRefresh = async () => {
  console.group('🧪 Testing Training Start Refresh');
  
  try {
    console.log('🚀 Triggering training-start operation...');
    
    const result = await operationRefreshManager.triggerOperationRefresh('training-start', {
      jobName: 'test-training-job',
      timestamp: new Date().toISOString(),
      source: 'manual-test'
    });
    
    console.log('✅ Result:', result);
    
    if (result.success) {
      console.log('✅ Training start refresh test PASSED');
    } else {
      console.warn('⚠️ Training start refresh test FAILED');
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  } finally {
    console.groupEnd();
  }
};

// 测试推理部署操作刷新
export const testModelDeployRefresh = async () => {
  console.group('🧪 Testing Model Deploy (Inference) Refresh');
  
  try {
    console.log('🚀 Triggering model-deploy operation...');
    
    const result = await operationRefreshManager.triggerOperationRefresh('model-deploy', {
      modelId: 'test-inference-model',
      deploymentType: 'VLLM',
      timestamp: new Date().toISOString(),
      source: 'manual-test'
    });
    
    console.log('✅ Result:', result);
    
    if (result.success) {
      console.log('✅ Model deploy refresh test PASSED');
    } else {
      console.warn('⚠️ Model deploy refresh test FAILED');
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  } finally {
    console.groupEnd();
  }
};

// 测试模型取消部署操作刷新
export const testModelUndeployRefresh = async () => {
  console.group('🧪 Testing Model Undeploy Refresh');
  
  try {
    console.log('🚀 Triggering model-undeploy operation...');
    
    const result = await operationRefreshManager.triggerOperationRefresh('model-undeploy', {
      modelTag: 'test-model-tag',
      deleteType: 'all',
      timestamp: new Date().toISOString(),
      source: 'manual-test'
    });
    
    console.log('✅ Result:', result);
    
    if (result.success) {
      console.log('✅ Model undeploy refresh test PASSED');
    } else {
      console.warn('⚠️ Model undeploy refresh test FAILED');
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  } finally {
    console.groupEnd();
  }
};

// 测试训练任务删除操作刷新
export const testTrainingDeleteRefresh = async () => {
  console.group('🧪 Testing Training Delete Refresh');
  
  try {
    console.log('🚀 Triggering training-delete operation...');
    
    const result = await operationRefreshManager.triggerOperationRefresh('training-delete', {
      jobName: 'test-training-job',
      timestamp: new Date().toISOString(),
      source: 'manual-test'
    });
    
    console.log('✅ Result:', result);
    
    if (result.success) {
      console.log('✅ Training delete refresh test PASSED');
    } else {
      console.warn('⚠️ Training delete refresh test FAILED');
    }
    
    return result;
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    return { success: false, error: error.message };
  } finally {
    console.groupEnd();
  }
};

// 检查组件注册状态
export const checkComponentRegistrations = () => {
  console.group('🔍 Checking Component Registrations');
  
  const stats = operationRefreshManager.getOperationStats();
  console.log('📊 Operation Manager Stats:', stats);
  
  const expectedComponents = [
    'app-status',
    'status-monitor',
    'pods-services',
    'training-monitor',
    'training-history', // 新增
    'deployment-manager'
  ];
  
  console.log('📋 Expected components:', expectedComponents);
  console.log('📋 Registered subscribers:', stats.subscriberCount);
  
  console.groupEnd();
  
  return stats;
};

// 运行所有测试
export const runAllOperationTests = async () => {
  console.group('🎯 Running All Operation Refresh Tests');
  
  const results = {
    timestamp: new Date().toISOString(),
    tests: {}
  };
  
  try {
    // 1. 检查组件注册
    console.log('1️⃣ Checking component registrations...');
    results.tests.componentRegistrations = checkComponentRegistrations();
    
    // 2. 测试模型下载
    console.log('2️⃣ Testing model download...');
    results.tests.modelDownload = await testModelDownloadRefresh();
    
    // 3. 测试训练启动
    console.log('3️⃣ Testing training start...');
    results.tests.trainingStart = await testTrainingStartRefresh();
    
    // 4. 测试推理部署
    console.log('4️⃣ Testing model deploy (inference)...');
    results.tests.modelDeploy = await testModelDeployRefresh();
    
    // 5. 测试模型取消部署
    console.log('5️⃣ Testing model undeploy...');
    results.tests.modelUndeploy = await testModelUndeployRefresh();
    
    // 6. 测试训练任务删除
    console.log('6️⃣ Testing training delete...');
    results.tests.trainingDelete = await testTrainingDeleteRefresh();
    
    // 计算总体结果
    const testResults = [
      results.tests.modelDownload.success,
      results.tests.trainingStart.success,
      results.tests.modelDeploy.success,
      results.tests.modelUndeploy.success,
      results.tests.trainingDelete.success
    ];
    
    const passedTests = testResults.filter(Boolean).length;
    const totalTests = testResults.length;
    
    results.overall = {
      passed: passedTests,
      total: totalTests,
      success: passedTests === totalTests,
      status: passedTests === totalTests ? '✅ ALL PASSED' : `⚠️ ${passedTests}/${totalTests} PASSED`
    };
    
    console.log('📋 Test Summary:', results.overall.status);
    
  } catch (error) {
    console.error('❌ Test suite failed:', error);
    results.error = error.message;
    results.overall = { status: '❌ FAILED' };
  }
  
  console.groupEnd();
  return results;
};

// 开发环境下暴露到window对象
if (process.env.NODE_ENV === 'development') {
  window.testModelDownloadRefresh = testModelDownloadRefresh;
  window.testTrainingStartRefresh = testTrainingStartRefresh;
  window.testModelDeployRefresh = testModelDeployRefresh;
  window.testModelUndeployRefresh = testModelUndeployRefresh;
  window.testTrainingDeleteRefresh = testTrainingDeleteRefresh;
  window.checkComponentRegistrations = checkComponentRegistrations;
  window.runAllOperationTests = runAllOperationTests;
}
