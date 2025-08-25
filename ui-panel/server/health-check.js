/**
 * 服务器健康检查工具
 * 用于监控服务器状态和诊断问题
 */

const http = require('http');
const WebSocket = require('ws');

class HealthChecker {
  constructor(httpPort = 3001, wsPort = 8081) {
    this.httpPort = httpPort;
    this.wsPort = wsPort;
  }

  /**
   * 检查HTTP服务器状态
   */
  async checkHttpServer() {
    return new Promise((resolve) => {
      const req = http.get(`http://localhost:${this.httpPort}/api/cluster-status`, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          resolve({
            status: 'healthy',
            statusCode: res.statusCode,
            responseTime: Date.now() - startTime,
            dataLength: data.length
          });
        });
      });

      const startTime = Date.now();
      
      req.on('error', (error) => {
        resolve({
          status: 'unhealthy',
          error: error.message,
          code: error.code
        });
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve({
          status: 'timeout',
          error: 'Request timeout after 5 seconds'
        });
      });
    });
  }

  /**
   * 检查WebSocket服务器状态
   */
  async checkWebSocketServer() {
    return new Promise((resolve) => {
      const startTime = Date.now();
      const ws = new WebSocket(`ws://localhost:${this.wsPort}`);
      
      const timeout = setTimeout(() => {
        ws.close();
        resolve({
          status: 'timeout',
          error: 'WebSocket connection timeout after 5 seconds'
        });
      }, 5000);

      ws.on('open', () => {
        clearTimeout(timeout);
        
        // 发送ping测试
        ws.send(JSON.stringify({
          type: 'ping',
          timestamp: new Date().toISOString(),
          healthCheck: true
        }));
      });

      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          if (message.type === 'pong' || message.type === 'status_update') {
            ws.close();
            resolve({
              status: 'healthy',
              responseTime: Date.now() - startTime,
              messageType: message.type
            });
          }
        } catch (error) {
          ws.close();
          resolve({
            status: 'unhealthy',
            error: 'Invalid WebSocket message format'
          });
        }
      });

      ws.on('error', (error) => {
        clearTimeout(timeout);
        resolve({
          status: 'unhealthy',
          error: error.message,
          code: error.code
        });
      });
    });
  }

  /**
   * 检查系统资源
   */
  checkSystemResources() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    
    return {
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        external: Math.round(memUsage.external / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024)
      },
      cpu: {
        user: cpuUsage.user,
        system: cpuUsage.system
      },
      uptime: Math.round(process.uptime()),
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    };
  }

  /**
   * 运行完整的健康检查
   */
  async runFullHealthCheck() {
    console.log('🏥 ========================================');
    console.log('🏥 Server Health Check Started');
    console.log('🏥 ========================================');
    
    const results = {
      timestamp: new Date().toISOString(),
      httpServer: null,
      webSocketServer: null,
      systemResources: null,
      overall: 'unknown'
    };

    try {
      // 检查HTTP服务器
      console.log('🔍 Checking HTTP server...');
      results.httpServer = await this.checkHttpServer();
      console.log(`📡 HTTP Server: ${results.httpServer.status}`, 
        results.httpServer.status === 'healthy' 
          ? `(${results.httpServer.responseTime}ms)` 
          : `(${results.httpServer.error})`
      );

      // 检查WebSocket服务器
      console.log('🔍 Checking WebSocket server...');
      results.webSocketServer = await this.checkWebSocketServer();
      console.log(`🔌 WebSocket Server: ${results.webSocketServer.status}`,
        results.webSocketServer.status === 'healthy'
          ? `(${results.webSocketServer.responseTime}ms)`
          : `(${results.webSocketServer.error})`
      );

      // 检查系统资源
      console.log('🔍 Checking system resources...');
      results.systemResources = this.checkSystemResources();
      console.log(`💾 Memory: ${results.systemResources.memory.heapUsed}MB used / ${results.systemResources.memory.heapTotal}MB total`);
      console.log(`⏰ Uptime: ${results.systemResources.uptime}s`);

      // 计算总体状态
      const httpHealthy = results.httpServer.status === 'healthy';
      const wsHealthy = results.webSocketServer.status === 'healthy';
      const memoryOk = results.systemResources.memory.heapUsed < 500; // 500MB阈值

      if (httpHealthy && wsHealthy && memoryOk) {
        results.overall = '✅ HEALTHY';
      } else if (httpHealthy && wsHealthy) {
        results.overall = '⚠️ DEGRADED';
      } else {
        results.overall = '❌ UNHEALTHY';
      }

    } catch (error) {
      console.error('❌ Health check failed:', error);
      results.error = error.message;
      results.overall = '❌ ERROR';
    }

    console.log('🏥 ========================================');
    console.log(`🏥 Overall Status: ${results.overall}`);
    console.log('🏥 ========================================');

    return results;
  }

  /**
   * 启动持续监控
   */
  startContinuousMonitoring(intervalMs = 60000) {
    console.log(`🔄 Starting continuous health monitoring (every ${intervalMs/1000}s)...`);
    
    const monitor = setInterval(async () => {
      const results = await this.runFullHealthCheck();
      
      // 如果状态不健康，发出警告
      if (results.overall.includes('UNHEALTHY') || results.overall.includes('ERROR')) {
        console.warn('🚨 ALERT: Server health check failed!');
        console.warn('🚨 Consider restarting the server or checking logs');
      }
    }, intervalMs);

    // 返回停止函数
    return () => {
      clearInterval(monitor);
      console.log('⏹️ Continuous health monitoring stopped');
    };
  }
}

// 如果直接运行此文件，执行健康检查
if (require.main === module) {
  const checker = new HealthChecker();
  
  // 解析命令行参数
  const args = process.argv.slice(2);
  const continuous = args.includes('--continuous') || args.includes('-c');
  const interval = args.find(arg => arg.startsWith('--interval='))?.split('=')[1] || 60000;

  if (continuous) {
    checker.startContinuousMonitoring(parseInt(interval));
  } else {
    checker.runFullHealthCheck().then(() => {
      process.exit(0);
    });
  }
}

module.exports = HealthChecker;
