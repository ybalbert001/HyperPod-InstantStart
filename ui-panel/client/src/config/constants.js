// 全局配置常量
export const CONFIG = {
  // 自动刷新间隔 (毫秒)
  AUTO_REFRESH_INTERVAL: 30000, // 30秒
  
  // API 端点
  API_ENDPOINTS: {
    PODS: '/api/pods',
    SERVICES: '/api/services',
    DEPLOYMENTS: '/api/deployments',
    DEPLOYMENT_DETAILS: '/api/deployment-details',
    DEPLOY: '/api/deploy',
    UNDEPLOY: '/api/undeploy',
    TEST_API: '/api/test-api'
  },
  
  // 消息显示时长
  MESSAGE_DURATION: {
    SUCCESS: 2,
    ERROR: 3,
    WARNING: 2
  }
};
