const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const { exec, spawn } = require('child_process');
const fs = require('fs-extra');
const YAML = require('yaml');
const path = require('path');
const https = require('https');
const http = require('http');

// 引入工具模块
const HyperPodDependencyManager = require('./utils/hyperPodDependencyManager');

// 引入集群状态V2模块
const { 
  handleClusterStatusV2, 
  handleClearCache, 
  handleCacheStatus 
} = require('./clusterStatusV2');

// 引入应用状态V2模块
const {
  handlePodsV2,
  handleServicesV2,
  handleAppStatusV2,
  handleClearAppCache,
  handleAppCacheStatus
} = require('./appStatusV2');

const app = express();
const PORT = 3001;
const WS_PORT = 8081; // 改为8081避免端口冲突

app.use(cors());
app.use(express.json());

// WebSocket服务器用于实时更新
const wss = new WebSocket.Server({ port: WS_PORT });

// 存储活跃的日志流
const activeLogStreams = new Map();

// 日志存储配置 - 简化路径结构
const LOGS_BASE_DIR = path.join(__dirname, '..', 'logs');

// 确保日志目录存在 - 简化版本，直接使用任务名
function ensureLogDirectory(jobName, podName) {
  const jobLogDir = path.join(LOGS_BASE_DIR, jobName);
  if (!fs.existsSync(jobLogDir)) {
    fs.mkdirSync(jobLogDir, { recursive: true });
  }
  return path.join(jobLogDir, `${podName}.log`);
}

// 广播消息给所有连接的客户端
function broadcast(data) {
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
}

// 优化错误消息的函数
function optimizeErrorMessage(errorMessage) {
  if (!errorMessage) return 'Unknown error';
  
  // 如果是获取hyperpodpytorchjob但资源类型不存在，这是正常情况
  if (errorMessage.includes(`doesn't have a resource type "hyperpodpytorchjob"`)) {
    return 'No HyperPod training jobs found (HyperPod operator may not be installed)';
  }
  // 如果是获取rayjob但资源类型不存在
  if (errorMessage.includes(`doesn't have a resource type "rayjob"`)) {
    return 'No RayJobs found (Ray operator may not be installed)';
  }
  // 如果是资源不存在，使用更友好的消息
  if (errorMessage.includes('not found') || errorMessage.includes('NotFound')) {
    return 'Resource not found - this may be normal if no resources have been created yet';
  }
  // 如果是连接问题
  if (errorMessage.includes('connection refused') || errorMessage.includes('unable to connect')) {
    return 'Unable to connect to Kubernetes cluster. Please check if the cluster is accessible.';
  }
  
  return errorMessage;
}

// 执行kubectl命令的辅助函数 - 简化版错误优化
function executeKubectl(command, timeout = 30000) { // 默认30秒超时
  return new Promise((resolve, reject) => {
    console.log(`Executing kubectl command: kubectl ${command}`);
    
    const child = exec(`kubectl ${command}`, { timeout }, (error, stdout, stderr) => {
      if (error) {
        console.error(`kubectl command failed: kubectl ${command}`);
        console.error(`Error details:`, error);
        console.error(`Stderr:`, stderr);
        
        if (error.code === 'ETIMEDOUT') {
          console.error(`kubectl command timed out after ${timeout}ms: ${command}`);
          reject(new Error(`Command timed out after ${timeout/1000} seconds. The cluster may be slow to respond.`));
        } else {
          const errorMessage = error.message || stderr || 'Unknown kubectl error';
          
          // 针对特定情况优化错误消息
          let optimizedMessage = errorMessage;
          
          // 如果是获取hyperpodpytorchjob但资源类型不存在，这是正常情况
          if (command.includes('get hyperpodpytorchjob') && 
              errorMessage.includes(`doesn't have a resource type "hyperpodpytorchjob"`)) {
            optimizedMessage = 'No HyperPod training jobs found (HyperPod operator may not be installed)';
          }
          // 如果是资源不存在，使用更友好的消息
          else if (errorMessage.includes('not found') || errorMessage.includes('NotFound')) {
            optimizedMessage = 'Resource not found - this may be normal if no resources have been created yet';
          }
          // 如果是连接问题
          else if (errorMessage.includes('connection refused') || errorMessage.includes('unable to connect')) {
            optimizedMessage = 'Unable to connect to Kubernetes cluster. Please check if the cluster is accessible.';
          }
          
          console.error(`Optimized error message: ${optimizedMessage}`);
          reject(new Error(optimizedMessage));
        }
      } else {
        console.log(`kubectl command succeeded: kubectl ${command}`);
        console.log(`Output:`, stdout);
        resolve(stdout);
      }
    });
    
    // 额外的超时保护
    const timeoutId = setTimeout(() => {
      child.kill('SIGTERM');
      console.error(`Force killing kubectl command after ${timeout}ms: ${command}`);
    }, timeout);
    
    child.on('exit', () => {
      clearTimeout(timeoutId);
    });
  });
}

// 简化的模型标签生成函数（用于模型下载）
function generateModelTag(modelId) {
  if (!modelId) return 'model';
  return modelId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'model';
}

// 生成NLB注解的函数
function generateNLBAnnotations(isExternal) {
  if (isExternal) {
    return `
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internet-facing"
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"`;
  } else {
    return `
    service.beta.kubernetes.io/aws-load-balancer-type: "external"
    service.beta.kubernetes.io/aws-load-balancer-nlb-target-type: "ip"
    service.beta.kubernetes.io/aws-load-balancer-scheme: "internal"
    service.beta.kubernetes.io/aws-load-balancer-cross-zone-load-balancing-enabled: "true"`;
  }
}

// 简化的命令解析函数 - 移除GPU自动解析逻辑
function parseVllmCommand(vllmCommandString) {
  // 移除换行符和多余空格，处理反斜杠换行
  const cleanCommand = vllmCommandString
    .replace(/\\\s*\n/g, ' ')  // 处理反斜杠换行
    .replace(/\s+/g, ' ')      // 合并多个空格
    .trim();
  
  // 分割命令为数组
  const parts = cleanCommand.split(' ').filter(part => part.trim());
  
  // 检查命令是否为空
  if (parts.length === 0) {
    throw new Error('Command cannot be empty');
  }
  
  // 检查是否为已知的命令格式（用于框架识别）
  const isVllmCommand = parts.includes('python3') && parts.includes('-m') && parts.includes('vllm.entrypoints.openai.api_server');
  const isVllmServeCommand = parts.includes('vllm') && parts.includes('serve');
  const isSglangCommand = parts.includes('python3') && parts.includes('-m') && parts.includes('sglang.launch_server');
  
  let entrypointIndex = -1;
  
  if (isVllmCommand) {
    entrypointIndex = parts.findIndex(part => part === 'vllm.entrypoints.openai.api_server');
  } else if (isVllmServeCommand) {
    entrypointIndex = parts.findIndex(part => part === 'serve');
  } else if (isSglangCommand) {
    entrypointIndex = parts.findIndex(part => part === 'sglang.launch_server');
  }
  
  const args = entrypointIndex >= 0 ? parts.slice(entrypointIndex + 1) : parts.slice(1);
  
  return {
    fullCommand: parts,
    args: args,
    commandType: (isVllmCommand || isVllmServeCommand) ? 'vllm' : (isSglangCommand ? 'sglang' : 'custom')
  };
}

// 改进的HTTP请求代理函数
function makeHttpRequest(url, payload, method = 'POST') {
  return new Promise((resolve, reject) => {
    try {
      const urlObj = new URL(url);
      const isHttps = urlObj.protocol === 'https:';
      const httpModule = isHttps ? https : http;
      
      const isGetRequest = method.toUpperCase() === 'GET';
      const postData = isGetRequest ? '' : JSON.stringify(payload);
      
      const options = {
        hostname: urlObj.hostname,
        port: urlObj.port || (isHttps ? 443 : 80),
        path: urlObj.pathname + urlObj.search,
        method: method.toUpperCase(),
        headers: {
          'User-Agent': 'Model-Deployment-UI/1.0'
        },
        timeout: 30000 // 30秒超时
      };
      
      // 只有POST请求才需要Content-Type和Content-Length
      if (!isGetRequest) {
        options.headers['Content-Type'] = 'application/json';
        options.headers['Content-Length'] = Buffer.byteLength(postData);
      }
      
      console.log(`Making HTTP ${method} request to: ${url}`);
      console.log(`Request options:`, JSON.stringify(options, null, 2));
      if (!isGetRequest) {
        console.log(`Payload:`, postData);
      }
      
      const req = httpModule.request(options, (res) => {
        let data = '';
        
        console.log(`Response status: ${res.statusCode}`);
        console.log(`Response headers:`, JSON.stringify(res.headers, null, 2));
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          console.log(`Response data:`, data);
          
          // 处理不同的响应状态
          if (res.statusCode >= 200 && res.statusCode < 300) {
            // 成功响应
            try {
              const jsonData = JSON.parse(data);
              resolve({
                success: true,
                status: res.statusCode,
                data: jsonData
              });
            } catch (parseError) {
              // 如果不是JSON，返回原始文本
              console.log('Response is not JSON, returning as text');
              resolve({
                success: true,
                status: res.statusCode,
                data: data,
                isText: true
              });
            }
          } else {
            // 错误响应
            try {
              const errorData = JSON.parse(data);
              resolve({
                success: false,
                status: res.statusCode,
                error: errorData.error || `HTTP ${res.statusCode}`,
                data: errorData
              });
            } catch (parseError) {
              resolve({
                success: false,
                status: res.statusCode,
                error: `HTTP ${res.statusCode}: ${data}`,
                data: data
              });
            }
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('HTTP request error:', error);
        reject({
          success: false,
          error: `Network error: ${error.message}`
        });
      });
      
      req.on('timeout', () => {
        console.error('HTTP request timeout');
        req.destroy();
        reject({
          success: false,
          error: 'Request timeout (30s)'
        });
      });
      
      // 只有非GET请求才写入payload
      if (!isGetRequest && postData) {
        req.write(postData);
      }
      req.end();
      
    } catch (error) {
      console.error('HTTP request setup error:', error);
      reject({
        success: false,
        error: `Request setup error: ${error.message}`
      });
    }
  });
}

// 获取Pending GPU统计
app.get('/api/pending-gpus', async (req, res) => {
  try {
    const pendingPodsOutput = await executeKubectl('get pods --field-selector status.phase=Pending -o json');
    const pendingPodsData = JSON.parse(pendingPodsOutput);
    
    let pendingGPUs = 0;
    if (pendingPodsData.items && Array.isArray(pendingPodsData.items)) {
      pendingGPUs = pendingPodsData.items.reduce((sum, pod) => {
        if (pod.spec?.containers) {
          return sum + pod.spec.containers.reduce((containerSum, container) => {
            const gpuRequest = container.resources?.requests?.['nvidia.com/gpu'];
            return containerSum + (parseInt(gpuRequest) || 0);
          }, 0);
        }
        return sum;
      }, 0);
    }
    
    res.json({ pendingGPUs });
  } catch (error) {
    console.error('Error fetching pending GPUs:', error);
    res.status(500).json({ error: error.message, pendingGPUs: 0 });
  }
});

// 获取集群节点GPU使用情况 - V2优化版本
app.get('/api/cluster-status', handleClusterStatusV2);

// 集群状态缓存管理API
app.post('/api/cluster-status/clear-cache', handleClearCache);
app.get('/api/cluster-status/cache-status', handleCacheStatus);

// 统一日志流管理 - 避免冲突
const unifiedLogStreams = new Map(); // 统一管理所有日志流

// 启动统一日志流（支持自动收集和WebSocket流式传输）
function startUnifiedLogStream(jobName, podName, options = {}) {
  const streamKey = `${jobName}-${podName}`;
  const { ws = null, autoCollection = false } = options;
  
  // 如果已经有该pod的日志流，添加WebSocket连接但不重启进程
  if (unifiedLogStreams.has(streamKey)) {
    const existing = unifiedLogStreams.get(streamKey);
    if (ws && !existing.webSockets.has(ws)) {
      existing.webSockets.add(ws);
      console.log(`Added WebSocket to existing log stream for ${streamKey}`);
      
      // 发送连接成功消息
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'log_stream_started',
          jobName: jobName,
          podName: podName,
          timestamp: new Date().toISOString()
        }));
      }
    }
    return;
  }
  
  console.log(`🚀 Starting unified log stream for pod: ${podName} in job: ${jobName} (auto: ${autoCollection})`);
  
  // 创建日志文件路径
  const logFilePath = ensureLogDirectory(jobName, podName);
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  
  // 启动kubectl logs命令
  const logProcess = spawn('kubectl', ['logs', '-f', podName], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  // 创建WebSocket集合
  const webSockets = new Set();
  if (ws) {
    webSockets.add(ws);
  }
  
  // 存储统一的日志流信息
  unifiedLogStreams.set(streamKey, {
    process: logProcess,
    logStream: logStream,
    webSockets: webSockets,
    jobName: jobName,
    podName: podName,
    autoCollection: autoCollection,
    startTime: new Date().toISOString()
  });
  
  // 处理标准输出
  logProcess.stdout.on('data', (data) => {
    const logLine = data.toString();
    const timestamp = new Date().toISOString();
    
    // 写入文件（带时间戳）
    logStream.write(`[${timestamp}] ${logLine}`);
    
    // 发送到所有连接的WebSocket
    webSockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'log_data',
          jobName: jobName,
          podName: podName,
          data: logLine,
          timestamp: timestamp
        }));
      }
    });
  });
  
  // 处理错误输出
  logProcess.stderr.on('data', (data) => {
    const errorLine = data.toString();
    const timestamp = new Date().toISOString();
    
    // 写入文件
    logStream.write(`[${timestamp}] ERROR: ${errorLine}`);
    
    // 发送错误到WebSocket
    webSockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'log_error',
          jobName: jobName,
          podName: podName,
          error: errorLine,
          timestamp: timestamp
        }));
      }
    });
  });
  
  // 处理进程退出
  logProcess.on('close', (code) => {
    console.log(`Unified log stream for ${podName} exited with code ${code}`);
    logStream.end();
    
    // 通知所有WebSocket连接
    webSockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'log_stream_closed',
          jobName: jobName,
          podName: podName,
          timestamp: new Date().toISOString()
        }));
      }
    });
    
    unifiedLogStreams.delete(streamKey);
  });
  
  // 处理进程错误
  logProcess.on('error', (error) => {
    console.error(`Unified log stream error for ${podName}:`, error);
    logStream.end();
    
    // 通知所有WebSocket连接
    webSockets.forEach(socket => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'log_stream_error',
          jobName: jobName,
          podName: podName,
          error: error.message,
          timestamp: new Date().toISOString()
        }));
      }
    });
    
    unifiedLogStreams.delete(streamKey);
  });
  
  // 发送启动成功消息
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'log_stream_started',
      jobName: jobName,
      podName: podName,
      timestamp: new Date().toISOString()
    }));
  }
}

// 从统一日志流中移除WebSocket连接
function removeWebSocketFromLogStream(ws, jobName, podName) {
  const streamKey = `${jobName}-${podName}`;
  const stream = unifiedLogStreams.get(streamKey);
  
  if (stream) {
    stream.webSockets.delete(ws);
    console.log(`Removed WebSocket from log stream ${streamKey}, remaining: ${stream.webSockets.size}`);
    
    // 如果没有WebSocket连接且不是自动收集，停止日志流
    if (stream.webSockets.size === 0 && !stream.autoCollection) {
      console.log(`No more WebSocket connections for ${streamKey}, stopping log stream`);
      stream.process.kill();
      stream.logStream.end();
      unifiedLogStreams.delete(streamKey);
    }
  }
}

// 为训练任务自动开始日志收集
async function startAutoLogCollectionForJob(jobName) {
  try {
    console.log(`🔍 Starting auto log collection for training job: ${jobName}`);
    
    // 获取该训练任务的所有pods
    const output = await executeKubectl('get pods -o json');
    const result = JSON.parse(output);
    
    const jobPods = result.items.filter(pod => {
      const labels = pod.metadata.labels || {};
      const ownerReferences = pod.metadata.ownerReferences || [];
      
      return labels['training-job-name'] === jobName || 
             labels['app'] === jobName ||
             ownerReferences.some(ref => ref.name === jobName) ||
             pod.metadata.name.includes(jobName);
    });
    
    // 为每个运行中的pod开始自动日志收集
    jobPods.forEach(pod => {
      if (pod.status.phase === 'Running' || pod.status.phase === 'Pending') {
        startUnifiedLogStream(jobName, pod.metadata.name, { autoCollection: true });
      }
    });
    
    console.log(`✅ Started auto log collection for ${jobPods.length} pods in job ${jobName}`);
  } catch (error) {
    console.error(`❌ Failed to start auto log collection for job ${jobName}:`, error);
  }
}

// 修改原有的startLogStream函数，使用统一管理
function startLogStream(ws, jobName, podName) {
  startUnifiedLogStream(jobName, podName, { ws: ws });
}

// 修改原有的stopLogStream函数
function stopLogStream(ws, jobName, podName) {
  removeWebSocketFromLogStream(ws, jobName, podName);
  
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'log_stream_stopped',
      jobName: jobName,
      podName: podName,
      timestamp: new Date().toISOString()
    }));
  }
}

// 应用状态V2 API - 优化版本
app.get('/api/v2/pods', handlePodsV2);
app.get('/api/v2/services', handleServicesV2);
app.get('/api/v2/app-status', handleAppStatusV2);
app.post('/api/v2/app-status/clear-cache', handleClearAppCache);
app.get('/api/v2/app-status/cache-status', handleAppCacheStatus);

// 获取Pod状态
app.get('/api/pods', async (req, res) => {
  try {
    console.log('Fetching pods...');
    const output = await executeKubectl('get pods -o json');
    const pods = JSON.parse(output);
    console.log('Pods fetched:', pods.items.length, 'pods');
    res.json(pods.items);
  } catch (error) {
    console.error('Pods fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取Service状态
app.get('/api/services', async (req, res) => {
  try {
    console.log('Fetching services...');
    const output = await executeKubectl('get services -o json');
    const services = JSON.parse(output);
    console.log('Services fetched:', services.items.length, 'services');
    res.json(services.items);
  } catch (error) {
    console.error('Services fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 代理HTTP请求到模型服务
app.post('/api/proxy-request', async (req, res) => {
  try {
    const { url, payload, method = 'POST' } = req.body;
    
    if (!url) {
      return res.status(400).json({
        success: false,
        error: 'Missing url'
      });
    }
    
    // GET请求不需要payload
    if (method.toUpperCase() !== 'GET' && payload === undefined) {
      return res.status(400).json({
        success: false,
        error: 'Missing payload for non-GET request'
      });
    }
    
    console.log(`Proxying ${method} request to: ${url}`);
    if (method.toUpperCase() !== 'GET') {
      console.log(`Payload:`, JSON.stringify(payload, null, 2));
    }
    
    const result = await makeHttpRequest(url, payload, method);
    
    console.log('Proxy result:', JSON.stringify(result, null, 2));
    res.json(result);
    
  } catch (error) {
    console.error('Proxy request error:', error);
    res.json({
      success: false,
      error: error.error || error.message || 'Request failed'
    });
  }
});

// 生成并部署YAML配置 - 仅用于推理部署（VLLM和Ollama）
app.post('/api/deploy', async (req, res) => {
  try {
    const {
      replicas,
      huggingFaceToken,
      deploymentType,
      vllmCommand,
      ollamaModelId,
      gpuCount,
      isExternal = true,
      deploymentName,  // 用户输入的部署名称
      dockerImage = 'vllm/vllm-openai:latest'
    } = req.body;

    console.log('Inference deployment request:', { 
      deploymentType, 
      deploymentName,
      ollamaModelId, 
      replicas, 
      isExternal,
      dockerImage
    });

    // 生成带时间戳的唯一标签（符合Kubernetes命名规范）
    const timestamp = new Date().toISOString()
      .replace(/[:.]/g, '-')     // 替换冒号和点号为连字符
      .replace('T', '-')         // 替换T为连字符
      .slice(0, 19);             // 截取到秒级
    const finalDeploymentTag = deploymentName ? `${deploymentName}-${timestamp}` : `model-${timestamp}`;
    
    console.log(`Generated deployment tag: "${finalDeploymentTag}"`);

    let templatePath, newYamlContent;

    // 生成NLB注解
    const nlbAnnotations = generateNLBAnnotations(isExternal);
    console.log(`Generated NLB annotations (external: ${isExternal}):`, nlbAnnotations);

    if (deploymentType === 'ollama') {
      // 处理Ollama部署
      templatePath = path.join(__dirname, '../templates/ollama-template.yaml');
      const templateContent = await fs.readFile(templatePath, 'utf8');
      
      // 替换模板中的占位符
      newYamlContent = templateContent
        .replace(/MODEL_TAG/g, finalDeploymentTag)
        .replace(/OLLAMA_MODEL_ID/g, ollamaModelId)
        .replace(/REPLICAS_COUNT/g, replicas.toString())
        .replace(/GPU_COUNT/g, gpuCount.toString())
        .replace(/NLB_ANNOTATIONS/g, nlbAnnotations);
      
    } else {
      // 处理VLLM/SGLang/Custom部署
      const parsedCommand = parseVllmCommand(vllmCommand);
      console.log('Parsed command:', parsedCommand);
      
      // 根据命令类型确定服务引擎前缀
      let servEngine;
      if (parsedCommand.commandType === 'sglang') {
        servEngine = 'sglang';
      } else if (parsedCommand.commandType === 'vllm') {
        servEngine = 'vllm';
      } else {
        servEngine = 'custom';  // 自定义命令使用custom前缀
      }
      console.log(`Using service engine: ${servEngine} for command type: ${parsedCommand.commandType}`);

      templatePath = path.join(__dirname, '../templates/vllm-sglang-template.yaml');
      const templateContent = await fs.readFile(templatePath, 'utf8');
      
      // 生成HuggingFace token环境变量（如果提供了token）
      let hfTokenEnv = '';
      if (huggingFaceToken && huggingFaceToken.trim() !== '') {
        hfTokenEnv = `
            - name: HUGGING_FACE_HUB_TOKEN
              value: "${huggingFaceToken}"`;
      }
      
      // 替换模板中的占位符 - 使用用户指定的GPU数量
      newYamlContent = templateContent
        .replace(/SERVENGINE/g, servEngine)
        .replace(/MODEL_TAG/g, finalDeploymentTag)
        .replace(/REPLICAS_COUNT/g, replicas.toString())
        .replace(/GPU_COUNT/g, gpuCount.toString())
        .replace(/HF_TOKEN_ENV/g, hfTokenEnv)
        .replace(/VLLM_COMMAND/g, JSON.stringify(parsedCommand.fullCommand))
        .replace(/DOCKER_IMAGE/g, dockerImage)
        .replace(/NLB_ANNOTATIONS/g, nlbAnnotations);
    }
    
    // 保存到项目目录中的deployments文件夹
    const deploymentsDir = path.join(__dirname, '../deployments');
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    const accessType = isExternal ? 'external' : 'internal';
    const tempYamlPath = path.join(deploymentsDir, `${finalDeploymentTag}-${deploymentType}-${accessType}.yaml`);
    await fs.writeFile(tempYamlPath, newYamlContent);
    
    console.log(`Generated YAML saved to: ${tempYamlPath}`);
    
    // 执行kubectl apply
    const applyOutput = await executeKubectl(`apply -f ${tempYamlPath}`);
    
    // 广播部署状态更新
    broadcast({
      type: 'deployment',
      status: 'success',
      message: `Successfully deployed: ${finalDeploymentTag} (${accessType} access)`,
      output: applyOutput
    });
    
    res.json({
      success: true,
      message: 'Deployment successful',
      output: applyOutput,
      yamlPath: tempYamlPath,
      generatedYaml: newYamlContent,
      deploymentType,
      deploymentTag: finalDeploymentTag,
      accessType
    });
    
  } catch (error) {
    console.error('Deployment error:', error);
    
    broadcast({
      type: 'deployment',
      status: 'error',
      message: `Deployment failed: ${error.message}`
    });
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 统一的训练YAML部署函数
async function deployTrainingYaml(recipeType, jobName, yamlContent) {
  try {
    // 确保temp目录存在
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 确保deployments/trainings目录存在
    const trainingsDir = path.join(__dirname, '../deployments/trainings');
    if (!fs.existsSync(trainingsDir)) {
      fs.mkdirSync(trainingsDir, { recursive: true });
    }

    // 写入临时文件（用于kubectl apply）
    const tempFileName = `${recipeType}-${jobName}-${Date.now()}.yaml`;
    const tempFilePath = path.join(tempDir, tempFileName);
    await fs.writeFile(tempFilePath, yamlContent);

    // 写入永久文件（用于记录）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const permanentFileName = `${recipeType}_${timestamp}.yaml`;
    const permanentFilePath = path.join(trainingsDir, permanentFileName);
    await fs.writeFile(permanentFilePath, yamlContent);

    console.log(`${recipeType} training YAML saved to: ${permanentFilePath}`);

    // 应用YAML配置
    const applyOutput = await executeKubectl(`apply -f ${tempFilePath}`);
    console.log(`${recipeType} training kubectl apply output:`, applyOutput);

    // 清理临时文件
    fs.unlinkSync(tempFilePath);

    // 发送WebSocket广播
    broadcast({
      type: 'training_launch',
      status: 'success',
      message: `Successfully launched ${recipeType} training job: ${jobName}`,
      output: applyOutput
    });

    return {
      success: true,
      permanentFileName,
      permanentFilePath,
      applyOutput
    };

  } catch (error) {
    // 发送错误广播
    broadcast({
      type: 'training_launch',
      status: 'error',
      message: `${recipeType} training launch failed: ${error.message}`
    });

    throw error;
  }
}

// 生成并部署HyperPod Torch训练任务 - 专门用于Torch训练
app.post('/api/launch-torch-training', async (req, res) => {
  try {
    console.log('Raw torch training request body:', JSON.stringify(req.body, null, 2));
    
    const {
      trainingJobName,
      dockerImage = '633205212955.dkr.ecr.us-west-2.amazonaws.com/sm-training-op-torch26-smhp-op:latest',
      instanceType = 'ml.g5.12xlarge',
      nprocPerNode = 1,
      replicas = 1,
      efaCount = 16,
      entryPythonScriptPath,
      pythonScriptParameters,
      mlflowTrackingUri = '',
      logMonitoringConfig
    } = req.body;

    console.log('Torch training launch request parsed:', { 
      trainingJobName,
      dockerImage,
      instanceType,
      nprocPerNode,
      replicas,
      efaCount,
      entryPythonScriptPath,
      pythonScriptParameters,
      mlflowTrackingUri,
      logMonitoringConfig: logMonitoringConfig ? 'present' : 'empty'
    });

    // 验证必需参数
    if (!trainingJobName) {
      return res.status(400).json({
        success: false,
        error: 'Training job name is required'
      });
    }

    if (!entryPythonScriptPath) {
      return res.status(400).json({
        success: false,
        error: 'Entry Python Script Path is required'
      });
    }

    if (!pythonScriptParameters) {
      return res.status(400).json({
        success: false,
        error: 'Python Script Parameters are required'
      });
    }

    // 读取Torch训练任务模板
    const templatePath = path.join(__dirname, '../templates/hyperpod-training-torch-template.yaml');
    const templateContent = await fs.readFile(templatePath, 'utf8');
    
    // 处理日志监控配置
    let logMonitoringConfigYaml = '';
    if (logMonitoringConfig && logMonitoringConfig.trim() !== '') {
      // 添加适当的缩进
      const indentedConfig = logMonitoringConfig
        .split('\n')
        .map(line => line.trim() ? `    ${line}` : line)
        .join('\n');
      logMonitoringConfigYaml = `
    logMonitoringConfiguration: 
${indentedConfig}`;
    }
    
    // 处理Python脚本参数 - 确保多行参数在YAML中正确格式化
    let formattedPythonParams = pythonScriptParameters;
    if (pythonScriptParameters.includes('\\')) {
      // 如果包含反斜杠换行符，将其转换为单行格式
      formattedPythonParams = pythonScriptParameters
        .replace(/\\\s*\n\s*/g, ' ')  // 将反斜杠换行替换为空格
        .replace(/\s+/g, ' ')         // 合并多个空格
        .trim();
    }
    
    // 替换模板中的占位符
    const newYamlContent = templateContent
      .replace(/TRAINING_JOB_NAME/g, trainingJobName)
      .replace(/DOCKER_IMAGE/g, dockerImage)
      .replace(/INSTANCE_TYPE/g, instanceType)
      .replace(/NPROC_PER_NODE/g, nprocPerNode.toString())
      .replace(/REPLICAS_COUNT/g, replicas.toString())
      .replace(/EFA_PER_NODE/g, efaCount.toString())
      .replace(/TORCH_RECIPE_PYPATH_PH/g, entryPythonScriptPath)
      .replace(/TORCH_RECIPE_PYPARAMS_PH/g, formattedPythonParams)
      .replace(/SM_MLFLOW_ARN/g, mlflowTrackingUri)
      .replace(/LOG_MONITORING_CONFIG/g, logMonitoringConfigYaml);

    console.log('Generated torch training YAML content:', newYamlContent);

    // 生成时间戳
    const timestamp = Date.now();
    
    // 生成临时文件名（用于kubectl apply）
    const tempFileName = `torch-training-${trainingJobName}-${timestamp}.yaml`;
    const tempFilePath = path.join(__dirname, '../temp', tempFileName);

    // 生成永久保存的文件名（保存到templates/training/目录）
    const permanentFileName = `torch_${timestamp}.yaml`;
    const permanentFilePath = path.join(__dirname, '../templates/training', permanentFileName);

    // 确保temp目录存在
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 确保templates/training目录存在
    const trainingTemplateDir = path.join(__dirname, '../templates/training');
    if (!fs.existsSync(trainingTemplateDir)) {
      fs.mkdirSync(trainingTemplateDir, { recursive: true });
    }

    // 写入临时文件（用于kubectl apply）
    await fs.writeFile(tempFilePath, newYamlContent);
    console.log(`Torch training YAML written to temp file: ${tempFilePath}`);

    // 写入永久文件（保存到templates/training/目录）
    await fs.writeFile(permanentFilePath, newYamlContent);
    console.log(`Torch training YAML saved permanently to: ${permanentFilePath}`);

    // 应用YAML配置 - 训练任务可能需要更长时间
    const applyOutput = await executeKubectl(`apply -f ${tempFilePath}`, 60000); // 60秒超时
    console.log('Torch training job apply output:', applyOutput);

    // 清理临时文件
    try {
      await fs.unlink(tempFilePath);
      console.log(`Temporary file deleted: ${tempFilePath}`);
    } catch (cleanupError) {
      console.warn(`Failed to delete temporary file: ${cleanupError.message}`);
    }

    // 广播训练任务启动状态更新
    broadcast({
      type: 'training_launch',
      status: 'success',
      message: `Successfully launched torch training job: ${trainingJobName}`,
      output: applyOutput
    });

    res.json({
      success: true,
      message: `Torch training job "${trainingJobName}" launched successfully`,
      trainingJobName: trainingJobName,
      savedTemplate: permanentFileName,
      savedTemplatePath: permanentFilePath,
      output: applyOutput
    });

  } catch (error) {
    console.error('Torch training launch error details:', {
      message: error.message,
      stack: error.stack,
      error: error
    });
    
    const errorMessage = error.message || error.toString() || 'Unknown error occurred';
    
    broadcast({
      type: 'training_launch',
      status: 'error',
      message: `Torch training launch failed: ${errorMessage}`
    });
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// 生成并部署HyperPod训练任务 - 专门用于LlamaFactory训练任务
app.post('/api/launch-training', async (req, res) => {
  try {
    console.log('Raw request body:', JSON.stringify(req.body, null, 2));
    
    const {
      trainingJobName,
      dockerImage = 'pytorch/pytorch:latest',
      instanceType = 'ml.g5.12xlarge',
      nprocPerNode = 1,
      replicas = 1,
      efaCount = 0,
      lmfRecipeRunPath,
      lmfRecipeYamlFile,
      mlflowTrackingUri = '',
      logMonitoringConfig
    } = req.body;

    console.log('Training launch request parsed:', { 
      trainingJobName,
      dockerImage,
      instanceType,
      nprocPerNode,
      replicas,
      efaCount,
      lmfRecipeRunPath,
      lmfRecipeYamlFile,
      mlflowTrackingUri,
      logMonitoringConfig: logMonitoringConfig ? 'present' : 'empty'
    });

    // 验证必需参数
    if (!trainingJobName) {
      return res.status(400).json({
        success: false,
        error: 'Training job name is required'
      });
    }

    if (!lmfRecipeRunPath) {
      return res.status(400).json({
        success: false,
        error: 'LlamaFactory Recipe Run Path is required'
      });
    }

    if (!lmfRecipeYamlFile) {
      return res.status(400).json({
        success: false,
        error: 'LlamaFactory Config YAML File Name is required'
      });
    }

    // 读取训练任务模板
    const templatePath = path.join(__dirname, '../templates/hyperpod-training-lmf-template.yaml');
    const templateContent = await fs.readFile(templatePath, 'utf8');
    
    // 处理日志监控配置
    let logMonitoringConfigYaml = '';
    if (logMonitoringConfig && logMonitoringConfig.trim() !== '') {
      // 添加适当的缩进
      const indentedConfig = logMonitoringConfig
        .split('\n')
        .map(line => line.trim() ? `    ${line}` : line)
        .join('\n');
      logMonitoringConfigYaml = `
    logMonitoringConfiguration: 
${indentedConfig}`;
    }
    
    // 替换模板中的占位符
    const newYamlContent = templateContent
      .replace(/TRAINING_JOB_NAME/g, trainingJobName)
      .replace(/DOCKER_IMAGE/g, dockerImage)
      .replace(/INSTANCE_TYPE/g, instanceType)
      .replace(/NPROC_PER_NODE/g, nprocPerNode.toString())
      .replace(/REPLICAS_COUNT/g, replicas.toString())
      .replace(/EFA_PER_NODE/g, efaCount.toString())
      .replace(/LMF_RECIPE_RUNPATH_PH/g, lmfRecipeRunPath)
      .replace(/LMF_RECIPE_YAMLFILE_PH/g, lmfRecipeYamlFile)
      .replace(/SM_MLFLOW_ARN/g, mlflowTrackingUri)
      .replace(/LOG_MONITORING_CONFIG/g, logMonitoringConfigYaml);

    console.log('Generated training YAML content:', newYamlContent);

    // 生成时间戳
    const timestamp = Date.now();
    
    // 生成临时文件名（用于kubectl apply）
    const tempFileName = `training-${trainingJobName}-${timestamp}.yaml`;
    const tempFilePath = path.join(__dirname, '../temp', tempFileName);

    // 生成永久保存的文件名（保存到templates/training/目录）
    const permanentFileName = `lma_${timestamp}.yaml`;
    const permanentFilePath = path.join(__dirname, '../templates/training', permanentFileName);

    // 确保temp目录存在
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 确保templates/training目录存在
    const trainingTemplateDir = path.join(__dirname, '../templates/training');
    if (!fs.existsSync(trainingTemplateDir)) {
      fs.mkdirSync(trainingTemplateDir, { recursive: true });
    }

    // 写入临时文件（用于kubectl apply）
    await fs.writeFile(tempFilePath, newYamlContent);
    console.log(`Training YAML written to temp file: ${tempFilePath}`);

    // 写入永久文件（保存到templates/training/目录）
    await fs.writeFile(permanentFilePath, newYamlContent);
    console.log(`Training YAML saved permanently to: ${permanentFilePath}`);

    // 应用YAML配置 - 训练任务可能需要更长时间
    const applyOutput = await executeKubectl(`apply -f ${tempFilePath}`, 60000); // 60秒超时
    console.log('Training job apply output:', applyOutput);

    // 清理临时文件
    try {
      await fs.unlink(tempFilePath);
      console.log(`Temporary file deleted: ${tempFilePath}`);
    } catch (cleanupError) {
      console.warn(`Failed to delete temporary file: ${cleanupError.message}`);
    }

    // 广播训练任务启动状态更新
    broadcast({
      type: 'training_launch',
      status: 'success',
      message: `Successfully launched training job: ${trainingJobName}`,
      output: applyOutput
    });

    res.json({
      success: true,
      message: `Training job "${trainingJobName}" launched successfully`,
      trainingJobName: trainingJobName,
      savedTemplate: permanentFileName,
      savedTemplatePath: permanentFilePath,
      output: applyOutput
    });

  } catch (error) {
    console.error('Training launch error details:', {
      message: error.message,
      stack: error.stack,
      error: error
    });
    
    const errorMessage = error.message || error.toString() || 'Unknown error occurred';
    
    broadcast({
      type: 'training_launch',
      status: 'error',
      message: `Training launch failed: ${errorMessage}`
    });
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// 保存LlamaFactory配置
app.post('/api/llamafactory-config/save', async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(__dirname, '../config/llamafactory-config.json');
    
    // 确保config目录存在
    const configDir = path.join(__dirname, '../config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log('LlamaFactory config saved:', config);
    
    res.json({
      success: true,
      message: 'LlamaFactory configuration saved successfully'
    });
  } catch (error) {
    console.error('Error saving training config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 加载LlamaFactory配置
app.get('/api/llamafactory-config/load', async (req, res) => {
  try {
    const configPath = path.join(__dirname, '../config/llamafactory-config.json');
    
    if (!fs.existsSync(configPath)) {
      // 返回默认配置
      const defaultConfig = {
        trainingJobName: 'lmf-v1',
        dockerImage: '633205212955.dkr.ecr.us-west-2.amazonaws.com/sm-training-op-torch26-smhp-op-v2:latest',
        instanceType: 'ml.g6.12xlarge',
        nprocPerNode: 4,
        replicas: 1,
        efaCount: 1,
        lmfRecipeRunPath: '/s3/train-recipes/llama-factory-project/',
        lmfRecipeYamlFile: 'qwen_full_dist_template.yaml',
        mlflowTrackingUri: '',
        logMonitoringConfig: ''
      };
      
      return res.json({
        success: true,
        config: defaultConfig,
        isDefault: true
      });
    }
    
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    console.log('LlamaFactory config loaded:', config);
    
    res.json({
      success: true,
      config: config,
      isDefault: false
    });
  } catch (error) {
    console.error('Error loading training config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 保存Script配置
app.post('/api/script-config/save', async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(__dirname, '../config/script-config.json');
    
    // 确保config目录存在
    const configDir = path.join(__dirname, '../config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log('Script config saved:', config);
    
    res.json({
      success: true,
      message: 'Script configuration saved successfully'
    });
  } catch (error) {
    console.error('Error saving script config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 加载Script配置
app.get('/api/script-config/load', async (req, res) => {
  try {
    const configPath = path.join(__dirname, '../config/script-config.json');
    
    if (!fs.existsSync(configPath)) {
      // 返回默认配置
      const defaultConfig = {
        trainingJobName: 'hypd-recipe-script-1',
        dockerImage: '633205212955.dkr.ecr.us-west-2.amazonaws.com/sm-training-op-torch26-smhp-op:latest',
        instanceType: 'ml.g5.12xlarge',
        nprocPerNode: 1,
        replicas: 1,
        efaCount: 16,
        projectPath: '/s3/training_code/my-training-project/',
        entryPath: 'train.py',
        mlflowTrackingUri: '',
        logMonitoringConfig: ''
      };
      
      return res.json({
        success: true,
        config: defaultConfig,
        isDefault: true
      });
    }
    
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    console.log('Script config loaded:', config);
    
    res.json({
      success: true,
      config: config,
      isDefault: false
    });
  } catch (error) {
    console.error('Error loading script config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 生成并部署HyperPod Script训练任务 - 专门用于Script训练
app.post('/api/launch-script-training', async (req, res) => {
  try {
    console.log('Raw script training request body:', JSON.stringify(req.body, null, 2));
    
    const {
      trainingJobName,
      dockerImage = '633205212955.dkr.ecr.us-west-2.amazonaws.com/sm-training-op-torch26-smhp-op:latest',
      instanceType = 'ml.g5.12xlarge',
      nprocPerNode = 1,
      replicas = 1,
      efaCount = 16,
      projectPath,
      entryPath,
      mlflowTrackingUri = '',
      logMonitoringConfig
    } = req.body;

    console.log('Script training launch request parsed:', { 
      trainingJobName,
      dockerImage,
      instanceType,
      nprocPerNode,
      replicas,
      efaCount,
      projectPath,
      entryPath,
      mlflowTrackingUri,
      logMonitoringConfig: logMonitoringConfig ? 'present' : 'empty'
    });

    // 验证必需参数
    if (!trainingJobName) {
      return res.status(400).json({
        success: false,
        error: 'Training job name is required'
      });
    }

    if (!projectPath) {
      return res.status(400).json({
        success: false,
        error: 'Project Path is required'
      });
    }

    if (!entryPath) {
      return res.status(400).json({
        success: false,
        error: 'Entry Script Path is required'
      });
    }

    // 读取Script训练任务模板
    const templatePath = path.join(__dirname, '../templates/hyperpod-training-script-template.yaml');
    const templateContent = await fs.readFile(templatePath, 'utf8');
    
    // 处理日志监控配置
    let logMonitoringConfigYaml = '';
    if (logMonitoringConfig && logMonitoringConfig.trim() !== '') {
      // 添加适当的缩进
      const indentedConfig = logMonitoringConfig
        .split('\n')
        .map(line => line.trim() ? `    ${line}` : line)
        .join('\n');
      logMonitoringConfigYaml = `
    logMonitoringConfiguration: 
${indentedConfig}`;
    }
    
    // 替换模板中的占位符
    const newYamlContent = templateContent
      .replace(/TRAINING_JOB_NAME/g, trainingJobName)
      .replace(/DOCKER_IMAGE/g, dockerImage)
      .replace(/INSTANCE_TYPE/g, instanceType)
      .replace(/NPROC_PER_NODE/g, nprocPerNode.toString())
      .replace(/REPLICAS_COUNT/g, replicas.toString())
      .replace(/EFA_PER_NODE/g, efaCount.toString())
      .replace(/SCRIPT_RECIPE_PROJECTPATH_PH/g, projectPath)
      .replace(/SCRIPT_RECIPE_ENTRYPATH_PH/g, entryPath)
      .replace(/SM_MLFLOW_ARN/g, mlflowTrackingUri)
      .replace(/LOG_MONITORING_CONFIG/g, logMonitoringConfigYaml);

    console.log('Generated script training YAML content:', newYamlContent);

    // 生成时间戳
    const timestamp = Date.now();
    
    // 生成临时文件名（用于kubectl apply）
    const tempFileName = `script-training-${trainingJobName}-${timestamp}.yaml`;
    const tempFilePath = path.join(__dirname, '../temp', tempFileName);

    // 生成永久保存的文件名（保存到templates/training/目录）
    const permanentFileName = `script_${timestamp}.yaml`;
    const permanentFilePath = path.join(__dirname, '../templates/training', permanentFileName);

    // 确保temp目录存在
    const tempDir = path.join(__dirname, '../temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // 确保templates/training目录存在
    const trainingTemplateDir = path.join(__dirname, '../templates/training');
    if (!fs.existsSync(trainingTemplateDir)) {
      fs.mkdirSync(trainingTemplateDir, { recursive: true });
    }

    // 写入临时文件（用于kubectl apply）
    await fs.writeFile(tempFilePath, newYamlContent);
    console.log(`Script training YAML written to temp file: ${tempFilePath}`);

    // 写入永久文件（保存到templates/training/目录）
    await fs.writeFile(permanentFilePath, newYamlContent);
    console.log(`Script training YAML saved permanently to: ${permanentFilePath}`);

    // 应用YAML配置 - 训练任务可能需要更长时间
    const applyOutput = await executeKubectl(`apply -f ${tempFilePath}`, 60000); // 60秒超时
    console.log('Script training job apply output:', applyOutput);

    // 清理临时文件
    try {
      await fs.unlink(tempFilePath);
      console.log(`Temporary file deleted: ${tempFilePath}`);
    } catch (cleanupError) {
      console.warn(`Failed to delete temporary file: ${cleanupError.message}`);
    }

    // 广播训练任务启动状态更新
    broadcast({
      type: 'training_launch',
      status: 'success',
      message: `Successfully launched script training job: ${trainingJobName}`,
      output: applyOutput
    });

    res.json({
      success: true,
      message: `Script training job "${trainingJobName}" launched successfully`,
      trainingJobName: trainingJobName,
      savedTemplate: permanentFileName,
      savedTemplatePath: permanentFilePath,
      output: applyOutput
    });

  } catch (error) {
    console.error('Script training launch error details:', {
      message: error.message,
      stack: error.stack,
      error: error
    });
    
    const errorMessage = error.message || error.toString() || 'Unknown error occurred';
    
    broadcast({
      type: 'training_launch',
      status: 'error',
      message: `Script training launch failed: ${errorMessage}`
    });
    
    res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// 保存Torch配置
app.post('/api/torch-config/save', async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(__dirname, '../config/torch-config.json');
    
    // 确保config目录存在
    const configDir = path.join(__dirname, '../config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log('Torch config saved:', config);
    
    res.json({
      success: true,
      message: 'Torch configuration saved successfully'
    });
  } catch (error) {
    console.error('Error saving torch config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 加载Torch配置
app.get('/api/torch-config/load', async (req, res) => {
  try {
    const configPath = path.join(__dirname, '../config/torch-config.json');
    
    if (!fs.existsSync(configPath)) {
      // 返回默认配置
      const defaultConfig = {
        trainingJobName: 'hypd-recipe-torch-1',
        dockerImage: '633205212955.dkr.ecr.us-west-2.amazonaws.com/sm-training-op-torch26-smhp-op:latest',
        instanceType: 'ml.g5.12xlarge',
        nprocPerNode: 1,
        replicas: 1,
        efaCount: 16,
        entryPythonScriptPath: '/s3/training_code/model-training-with-hyperpod-training-operator/torch-training.py',
        pythonScriptParameters: '--learning_rate 1e-5 \\\n--batch_size 1',
        mlflowTrackingUri: '',
        logMonitoringConfig: ''
      };
      
      return res.json({
        success: true,
        config: defaultConfig,
        isDefault: true
      });
    }
    
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    console.log('Torch config loaded:', config);
    
    res.json({
      success: true,
      config: config,
      isDefault: false
    });
  } catch (error) {
    console.error('Error loading torch config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 保存verl配置
app.post('/api/verl-config/save', async (req, res) => {
  try {
    const config = req.body;
    const configPath = path.join(__dirname, '../config/verl-config.json');
    
    // 确保config目录存在
    const configDir = path.join(__dirname, '../config');
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    
    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log('VERL config saved:', config);
    
    res.json({
      success: true,
      message: 'VERL configuration saved successfully'
    });
  } catch (error) {
    console.error('Error saving VERL config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 加载verl配置
app.get('/api/verl-config/load', async (req, res) => {
  try {
    const configPath = path.join(__dirname, '../config/verl-config.json');
    
    if (!fs.existsSync(configPath)) {
      // 返回默认配置
      const defaultConfig = {
        jobName: 'verl-training-a1',
        instanceType: 'ml.g5.12xlarge',
        entryPointPath: 'verl-project/src/qwen-3b-grpo-kuberay.sh',
        dockerImage: '633205212955.dkr.ecr.us-west-2.amazonaws.com/hypd-verl:latest',
        workerReplicas: 1,
        gpuPerNode: 4,
        efaPerNode: 1
      };
      
      return res.json({
        success: true,
        config: defaultConfig,
        isDefault: true
      });
    }
    
    const configContent = await fs.readFile(configPath, 'utf8');
    const config = JSON.parse(configContent);
    
    console.log('VERL config loaded:', config);
    
    res.json({
      success: true,
      config: config,
      isDefault: false
    });
  } catch (error) {
    console.error('Error loading VERL config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 生成并部署VERL训练任务 - 专门用于VERL训练
app.post('/api/launch-verl-training', async (req, res) => {
  try {
    console.log('Raw VERL training request body:', JSON.stringify(req.body, null, 2));
    
    const {
      jobName,
      instanceType = 'ml.g5.12xlarge',
      entryPointPath,
      dockerImage,
      workerReplicas = 1,
      gpuPerNode = 4,
      efaPerNode = 1,
      recipeType
    } = req.body;

    console.log('VERL training launch request parsed:', { 
      jobName,
      instanceType,
      entryPointPath,
      dockerImage,
      workerReplicas,
      gpuPerNode,
      efaPerNode,
      recipeType
    });

    // 验证必需参数
    if (!jobName) {
      return res.status(400).json({
        success: false,
        error: 'Job name is required'
      });
    }

    if (!entryPointPath) {
      return res.status(400).json({
        success: false,
        error: 'Entry point path is required'
      });
    }

    if (!dockerImage) {
      return res.status(400).json({
        success: false,
        error: 'Docker image is required'
      });
    }

    // 读取VERL训练任务模板
    const templatePath = path.join(__dirname, '../templates/verl-training-template.yaml');
    const templateContent = await fs.readFile(templatePath, 'utf8');
    
    // 替换模板中的占位符
    const newYamlContent = templateContent
      .replace(/JOB_NAME/g, jobName)
      .replace(/ENTRY_POINT_PATH/g, entryPointPath)
      .replace(/DOCKER_IMAGE/g, dockerImage)
      .replace(/WORKER_REPLICAS/g, workerReplicas.toString())
      .replace(/MAX_REPLICAS/g, Math.max(3, workerReplicas + 2).toString())
      .replace(/GPU_PER_NODE/g, gpuPerNode.toString())
      .replace(/EFA_PER_NODE/g, efaPerNode.toString());

    console.log('Generated VERL YAML content preview:', newYamlContent.substring(0, 500) + '...');

    // 使用统一的部署函数
    const deployResult = await deployTrainingYaml('verl', jobName, newYamlContent);

    res.json({
      success: true,
      message: `VERL training job "${jobName}" launched successfully`,
      jobName: jobName,
      templateUsed: 'verl-training-template.yaml',
      savedTemplate: deployResult.permanentFileName,
      savedTemplatePath: deployResult.permanentFilePath,
      output: deployResult.applyOutput
    });

  } catch (error) {
    console.error('VERL training launch error:', error);
    
    res.status(500).json({
      success: false,
      error: error.message || 'Unknown error occurred'
    });
  }
});

// 获取所有RayJob
app.get('/api/rayjobs', async (req, res) => {
  try {
    const output = await executeKubectl('get rayjobs -o json');
    const rayjobs = JSON.parse(output);
    res.json(rayjobs.items);
  } catch (error) {
    console.error('RayJobs fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 删除指定的RayJob
app.delete('/api/rayjobs/:jobName', async (req, res) => {
  try {
    const { jobName } = req.params;
    console.log(`Deleting RayJob: ${jobName}`);
    
    const output = await executeKubectl(`delete rayjob ${jobName}`);
    console.log('RayJob delete output:', output);
    
    // 发送WebSocket广播
    broadcast({
      type: 'rayjob_deleted',
      status: 'success',
      message: `RayJob "${jobName}" deleted successfully`,
      jobName: jobName
    });
    
    res.json({
      success: true,
      message: `RayJob "${jobName}" deleted successfully`,
      output: output
    });
  } catch (error) {
    console.error('Error deleting RayJob:', error);
    
    broadcast({
      type: 'rayjob_deleted',
      status: 'error',
      message: `Failed to delete RayJob: ${error.message}`
    });
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取所有HyperPod训练任务
app.get('/api/training-jobs', async (req, res) => {
  try {
    console.log('Fetching training jobs (HyperPod PytorchJob + RayJob)...');
    
    // 获取HyperPod PytorchJob
    let hyperpodJobs = [];
    try {
      const hyperpodOutput = await executeKubectl('get hyperpodpytorchjob -o json');
      const hyperpodResult = JSON.parse(hyperpodOutput);
      hyperpodJobs = hyperpodResult.items.map(job => ({
        name: job.metadata.name,
        namespace: job.metadata.namespace || 'default',
        creationTimestamp: job.metadata.creationTimestamp,
        status: job.status || {},
        type: 'hyperpod',
        spec: {
          replicas: job.spec?.replicaSpecs?.[0]?.replicas || 0,
          nprocPerNode: job.spec?.nprocPerNode || 0
        }
      }));
    } catch (error) {
      const optimizedMessage = optimizeErrorMessage(error.message);
      console.log('No HyperPod PytorchJobs found or error:', optimizedMessage);
      // 对于导入的集群，这是正常的 - 不记录为错误
    }

    // 获取RayJob
    let rayJobs = [];
    try {
      const rayOutput = await executeKubectl('get rayjob -o json');
      const rayResult = JSON.parse(rayOutput);
      rayJobs = rayResult.items.map(job => ({
        name: job.metadata.name,
        namespace: job.metadata.namespace || 'default',
        creationTimestamp: job.metadata.creationTimestamp,
        status: job.status || {},
        type: 'rayjob',
        spec: {
          replicas: 1, // RayJob通常是单个作业
          nprocPerNode: 1
        }
      }));
    } catch (error) {
      const optimizedMessage = optimizeErrorMessage(error.message);
      console.log('No RayJobs found or error:', optimizedMessage);
      // 对于导入的集群，这是正常的 - 不记录为错误
    }

    // 合并两种类型的作业
    const trainingJobs = [...hyperpodJobs, ...rayJobs];
    
    console.log(`Found ${trainingJobs.length} training jobs (${hyperpodJobs.length} HyperPod + ${rayJobs.length} Ray):`, 
                trainingJobs.map(j => `${j.name}(${j.type})`));
    
    res.json({
      success: true,
      jobs: trainingJobs
    });
  } catch (error) {
    console.error('Error fetching training jobs:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      jobs: []
    });
  }
});

// 删除指定的HyperPod训练任务
app.delete('/api/training-jobs/:jobName', async (req, res) => {
  try {
    const { jobName } = req.params;
    console.log(`Deleting training job: ${jobName}`);
    
    const output = await executeKubectl(`delete hyperpodpytorchjob ${jobName}`);
    console.log('Delete output:', output);
    
    // 广播删除状态更新
    broadcast({
      type: 'training_job_deleted',
      status: 'success',
      message: `Training job "${jobName}" deleted successfully`,
      jobName: jobName
    });
    
    res.json({
      success: true,
      message: `Training job "${jobName}" deleted successfully`,
      output: output
    });
  } catch (error) {
    console.error('Error deleting training job:', error);
    
    broadcast({
      type: 'training_job_deleted',
      status: 'error',
      message: `Failed to delete training job: ${error.message}`
    });
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// MLflow配置管理

const CONFIG_FILE = path.join(__dirname, '../config/mlflow-metric-config.json');

// 确保配置目录存在
const configDir = path.dirname(CONFIG_FILE);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}

// 默认MLflow配置
const DEFAULT_MLFLOW_CONFIG = {
  tracking_uri: '',
  experiment_id: '',
  sync_configs: {}
};

// 读取MLflow配置
function readMlflowConfig() {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const configData = fs.readFileSync(CONFIG_FILE, 'utf8');
      return JSON.parse(configData);
    }
  } catch (error) {
    console.error('Error reading MLflow config:', error);
  }
  return DEFAULT_MLFLOW_CONFIG;
}

// 保存MLflow配置
function saveMlflowConfig(config) {
  try {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving MLflow config:', error);
    return false;
  }
}

// 获取MLflow配置
app.get('/api/mlflow-metric-config', (req, res) => {
  try {
    const config = readMlflowConfig();
    res.json({
      success: true,
      config: config
    });
  } catch (error) {
    console.error('Error fetching MLflow config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 保存MLflow配置
app.post('/api/mlflow-metric-config', (req, res) => {
  try {
    const { tracking_uri } = req.body;
    
    if (!tracking_uri) {
      return res.status(400).json({
        success: false,
        error: 'tracking_uri is required'
      });
    }

    const config = { tracking_uri };
    
    if (saveMlflowConfig(config)) {
      console.log('MLflow config saved:', config);
      res.json({
        success: true,
        config: config
      });
    } else {
      res.status(500).json({
        success: false,
        error: 'Failed to save configuration'
      });
    }
  } catch (error) {
    console.error('Error saving MLflow config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 测试MLflow连接
app.post('/api/mlflow-metric-config/test', async (req, res) => {
  try {
    const { tracking_uri } = req.body;
    
    if (!tracking_uri) {
      return res.status(400).json({
        success: false,
        error: 'tracking_uri is required'
      });
    }

    console.log(`Testing MLflow connection to: ${tracking_uri}`);
    
    const { spawn } = require('child_process');
    
    // 创建测试脚本
    const testScript = `#!/usr/bin/env python3
import mlflow
import sys
import json

try:
    tracking_uri = "${tracking_uri}"
    mlflow.set_tracking_uri(tracking_uri)
    
    # 尝试获取实验列表来测试连接
    experiments = mlflow.search_experiments()
    
    result = {
        "success": True,
        "experiments_count": len(experiments),
        "message": f"Successfully connected to MLflow. Found {len(experiments)} experiments."
    }
    
    print(json.dumps(result))
    sys.exit(0)
    
except Exception as e:
    result = {
        "success": False,
        "error": str(e)
    }
    print(json.dumps(result))
    sys.exit(1)
`;
    
    const tempScriptPath = path.join(__dirname, '../temp/test_mlflow_connection.py');
    
    // 确保temp目录存在
    const tempDir = path.dirname(tempScriptPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    fs.writeFileSync(tempScriptPath, testScript);
    
    const pythonPath = 'python3'; // 使用系统Python
    const pythonProcess = spawn(pythonPath, [tempScriptPath], {
      cwd: __dirname,
      env: { ...process.env }
    });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      // 清理临时文件
      try {
        fs.unlinkSync(tempScriptPath);
      } catch (e) {
        console.warn('Failed to cleanup temp file:', e);
      }
      
      if (stderr) {
        console.log('Python test script stderr:', stderr);
      }
      
      try {
        const result = JSON.parse(stdout);
        if (result.success) {
          res.json(result);
        } else {
          res.status(400).json(result);
        }
      } catch (parseError) {
        console.error('Failed to parse test result:', parseError);
        console.error('Raw output:', stdout);
        res.status(500).json({
          success: false,
          error: 'Failed to test MLflow connection',
          details: stdout || stderr
        });
      }
    });
    
    pythonProcess.on('error', (error) => {
      console.error('Failed to start Python test script:', error);
      res.status(500).json({
        success: false,
        error: `Failed to start test script: ${error.message}`
      });
    });
    
  } catch (error) {
    console.error('MLflow connection test error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// MLflow跨账户同步API
app.post('/api/mlflow-sync', async (req, res) => {
  try {
    const { sync_config, experiment_name, experiment_id } = req.body;
    
    // 支持两种参数格式以保持兼容性
    const experimentIdentifier = experiment_name || experiment_id;
    
    // 验证必需字段
    if (!sync_config || !experimentIdentifier) {
      return res.status(400).json({
        success: false,
        error: 'sync_config and experiment_name (or experiment_id) are required'
      });
    }

    // 验证JSON配置
    let configObj;
    try {
      configObj = JSON.parse(sync_config);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: 'Invalid JSON format in sync_config'
      });
    }

    // 验证必需的配置字段
    const requiredFields = ['contributor_name', 'source_mlflow_arn', 'shared_account_id', 'shared_aws_region', 'cross_account_role_arn', 'shared_mlflow_arn'];
    const missingFields = requiredFields.filter(field => !configObj[field]);
    if (missingFields.length > 0) {
      return res.status(400).json({
        success: false,
        error: `Missing required fields in sync_config: ${missingFields.join(', ')}`
      });
    }

    // 验证source和destination ARN不能相同
    if (configObj.source_mlflow_arn === configObj.shared_mlflow_arn) {
      return res.status(400).json({
        success: false,
        error: 'Source MLflow ARN and Shared MLflow ARN cannot be the same. Please ensure you are syncing to a different MLflow server.'
      });
    }

    // 添加时间戳
    configObj.setup_date = new Date().toISOString();

    console.log(`Starting MLflow sync for experiment ${experimentIdentifier}...`);
    
    // 1. 保存配置到mlflow-metric-config.json
    const currentConfig = readMlflowConfig();
    const updatedConfig = {
      ...currentConfig,
      experiment_name: experimentIdentifier,  // 改为experiment_name
      sync_configs: {
        ...configObj,
        last_sync: new Date().toISOString()
      }
    };
    
    if (!saveMlflowConfig(updatedConfig)) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save sync configuration'
      });
    }

    // 2. 创建临时配置文件供Python脚本使用
    const tempConfigPath = path.join(__dirname, '../temp/sync-config-temp.json');
    
    // 确保temp目录存在
    const tempDir = path.dirname(tempConfigPath);
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    
    fs.writeFileSync(tempConfigPath, JSON.stringify(configObj, null, 2));

    // 3. 调用Python同步脚本
    const { spawn } = require('child_process');
    const pythonPath = 'python3'; // 使用系统Python
    const syncScriptPath = path.join(__dirname, '../mlflow/cross_account_sync.py');
    
    const pythonProcess = spawn(pythonPath, [
      syncScriptPath,
      '--config-file', tempConfigPath,
      '--experiment-name', experimentIdentifier
    ], {
      cwd: __dirname,
      env: { ...process.env }
    });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    pythonProcess.on('close', (code) => {
      // 清理临时配置文件
      try {
        fs.unlinkSync(tempConfigPath);
      } catch (e) {
        console.warn('Failed to cleanup temp config file:', e);
      }
      
      if (code === 0) {
        console.log('MLflow sync completed successfully');
        console.log('Sync output:', stdout);
        
        res.json({
          success: true,
          message: 'Successfully synced experiment to shared MLflow server',
          output: stdout,
          experiment_id: experimentIdentifier,
          contributor: configObj.contributor_name
        });
      } else {
        console.error('MLflow sync failed with code:', code);
        console.error('Sync stderr:', stderr);
        console.error('Sync stdout:', stdout);
        
        res.status(500).json({
          success: false,
          error: 'MLflow sync failed',
          details: stderr || stdout,
          exit_code: code
        });
      }
    });
    
    pythonProcess.on('error', (error) => {
      console.error('Failed to start MLflow sync script:', error);
      
      // 清理临时配置文件
      try {
        fs.unlinkSync(tempConfigPath);
      } catch (e) {
        console.warn('Failed to cleanup temp config file:', e);
      }
      
      res.status(500).json({
        success: false,
        error: `Failed to start sync script: ${error.message}`
      });
    });
    
  } catch (error) {
    console.error('MLflow sync API error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 创建MLflow Tracking Server API
app.post('/api/create-mlflow-tracking-server', async (req, res) => {
  try {
    const { mlflowServerName, trackingServerSize = 'Small' } = req.body;
    
    const MLflowTrackingServerManager = require('./utils/mlflowTrackingServerManager');
    const mlflowManager = new MLflowTrackingServerManager();
    
    // 验证输入参数
    mlflowManager.validateServerName(mlflowServerName);
    mlflowManager.validateServerSize(trackingServerSize);
    
    // 创建tracking server
    const result = await mlflowManager.createTrackingServer(mlflowServerName, trackingServerSize);
    
    // 广播创建成功消息
    broadcast({
      type: 'mlflow_tracking_server_created',
      status: 'success',
      message: result.message,
      serverName: mlflowServerName
    });
    
    res.json(result);
    
  } catch (error) {
    console.error('Error creating MLflow tracking server:', error);
    
    // 广播创建失败消息
    broadcast({
      type: 'mlflow_tracking_server_created',
      status: 'error',
      message: error.message
    });
    
    res.json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 获取训练历史数据（从MLflow）
app.get('/api/training-history', async (req, res) => {
  try {
    console.log('Fetching training history from MLflow...');
    
    // 读取当前MLflow配置
    const mlflowConfig = readMlflowConfig();
    console.log('Using MLflow URI:', mlflowConfig.tracking_uri);
    
    const { spawn } = require('child_process');
    const path = require('path');
    
    // 使用系统Python执行脚本，传递配置参数
    const pythonPath = 'python3'; // 使用系统Python
    const scriptPath = path.join(__dirname, '../mlflow/get_training_history.py');
    
    const pythonProcess = spawn(pythonPath, [scriptPath, mlflowConfig.tracking_uri], {
      cwd: __dirname,
      env: { ...process.env }
    });
    
    let stdout = '';
    let stderr = '';
    
    pythonProcess.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    pythonProcess.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    let responseHandled = false;
    
    pythonProcess.on('close', (code) => {
      if (responseHandled) return;
      
      if (stderr) {
        console.log('Python script stderr:', stderr);
      }
      
      if (code !== 0) {
        console.error(`Python script exited with code ${code}`);
        responseHandled = true;
        return res.status(500).json({ 
          success: false, 
          error: `Failed to fetch training history: exit code ${code}`,
          stderr: stderr
        });
      }
      
      try {
        const result = JSON.parse(stdout);
        console.log(`Training history fetched: ${result.total} records`);
        responseHandled = true;
        res.json(result);
      } catch (parseError) {
        console.error('Failed to parse Python script output:', parseError);
        console.error('Raw output:', stdout);
        responseHandled = true;
        res.status(500).json({ 
          success: false, 
          error: 'Failed to parse training history data',
          raw_output: stdout
        });
      }
    });
    
    pythonProcess.on('error', (error) => {
      if (responseHandled) return;
      
      console.error('Failed to start Python script:', error);
      responseHandled = true;
      res.status(500).json({ 
        success: false, 
        error: `Failed to start Python script: ${error.message}`
      });
    });
    
  } catch (error) {
    console.error('Training history fetch error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 获取训练任务关联的pods
app.get('/api/training-jobs/:jobName/pods', async (req, res) => {
  try {
    const { jobName } = req.params;
    console.log(`Fetching pods for training job: ${jobName}`);
    
    // 获取所有pods，然后筛选出属于该训练任务的pods
    const output = await executeKubectl('get pods -o json');
    const result = JSON.parse(output);
    
    // 筛选出属于该训练任务的pods
    const trainingPods = result.items.filter(pod => {
      const labels = pod.metadata.labels || {};
      const ownerReferences = pod.metadata.ownerReferences || [];
      
      // 检查是否通过标签或ownerReferences关联到训练任务
      return labels['training-job-name'] === jobName || 
             labels['app'] === jobName ||
             ownerReferences.some(ref => ref.name === jobName) ||
             pod.metadata.name.includes(jobName);
    });
    
    const pods = trainingPods.map(pod => ({
      name: pod.metadata.name,
      namespace: pod.metadata.namespace || 'default',
      status: pod.status.phase,
      creationTimestamp: pod.metadata.creationTimestamp,
      nodeName: pod.spec.nodeName,
      containerStatuses: pod.status.containerStatuses || []
    }));
    
    console.log(`Found ${pods.length} pods for training job ${jobName}:`, pods.map(p => p.name));
    
    res.json({
      success: true,
      pods: pods
    });
  } catch (error) {
    console.error('Error fetching training job pods:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      pods: []
    });
  }
});

// 获取完整日志文件
app.get('/api/logs/:jobName/:podName', (req, res) => {
  try {
    const { jobName, podName } = req.params;
    const logFilePath = path.join(LOGS_BASE_DIR, jobName, `${podName}.log`);
    
    if (fs.existsSync(logFilePath)) {
      res.sendFile(path.resolve(logFilePath));
    } else {
      res.status(404).json({ 
        success: false, 
        error: 'Log file not found',
        path: logFilePath
      });
    }
  } catch (error) {
    console.error('Error serving log file:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 下载完整日志文件
app.get('/api/logs/:jobName/:podName/download', (req, res) => {
  try {
    const { jobName, podName } = req.params;
    const logFilePath = path.join(LOGS_BASE_DIR, jobName, `${podName}.log`);
    
    if (fs.existsSync(logFilePath)) {
      res.download(logFilePath, `${podName}.log`, (err) => {
        if (err) {
          console.error('Error downloading log file:', err);
          res.status(500).json({ 
            success: false, 
            error: 'Failed to download log file' 
          });
        }
      });
    } else {
      res.status(404).json({ 
        success: false, 
        error: 'Log file not found',
        path: logFilePath
      });
    }
  } catch (error) {
    console.error('Error downloading log file:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 获取日志文件信息
app.get('/api/logs/:jobName/:podName/info', (req, res) => {
  try {
    const { jobName, podName } = req.params;
    const logFilePath = path.join(LOGS_BASE_DIR, jobName, `${podName}.log`);
    
    if (fs.existsSync(logFilePath)) {
      const stats = fs.statSync(logFilePath);
      res.json({
        success: true,
        info: {
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime,
          path: logFilePath
        }
      });
    } else {
      res.status(404).json({ 
        success: false, 
        error: 'Log file not found' 
      });
    }
  } catch (error) {
    console.error('Error getting log file info:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// 删除部署 - 改进版本
app.post('/api/undeploy', async (req, res) => {
  try {
    const { modelTag, deleteType } = req.body;
    
    if (!modelTag) {
      return res.status(400).json({
        success: false,
        error: 'Model tag is required'
      });
    }
    
    console.log(`Undeploying model: ${modelTag}, type: ${deleteType}`);
    
    // 构建可能的资源名称
    const possibleDeployments = [
      `vllm-${modelTag}-inference`,
      `sglang-${modelTag}-inference`,
      `olm-${modelTag}-inference`,
      `${modelTag}-inference`  // 备用格式
    ];
    
    const possibleServices = [
      `vllm-${modelTag}-nlb`,
      `sglang-${modelTag}-nlb`,
      `olm-${modelTag}-nlb`,
      `${modelTag}-nlb`,
      `${modelTag}-service`  // 备用格式
    ];
    
    let deleteCommands = [];
    let deletedResources = [];
    
    // 根据删除类型决定删除哪些资源
    if (deleteType === 'all' || deleteType === 'deployment') {
      possibleDeployments.forEach(deploymentName => {
        deleteCommands.push(`delete deployment ${deploymentName} --ignore-not-found=true`);
      });
      deletedResources.push('Deployment');
    }
    
    if (deleteType === 'all' || deleteType === 'service') {
      possibleServices.forEach(serviceName => {
        deleteCommands.push(`delete service ${serviceName} --ignore-not-found=true`);
      });
      deletedResources.push('Service');
    }
    
    // 执行删除命令
    const results = [];
    let actuallyDeleted = 0;
    
    for (const command of deleteCommands) {
      try {
        const output = await executeKubectl(command);
        const success = !output.includes('not found');
        results.push({
          command,
          success: true,
          output: output.trim(),
          actuallyDeleted: success
        });
        if (success) actuallyDeleted++;
      } catch (error) {
        results.push({
          command,
          success: false,
          error: error.error || error.message,
          actuallyDeleted: false
        });
      }
    }
    
    // 等待一下让资源完全删除
    if (actuallyDeleted > 0) {
      console.log(`Waiting for resources to be fully deleted...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // 广播删除状态更新
    broadcast({
      type: 'undeployment',
      status: 'success',
      message: `Successfully deleted resources for ${modelTag} (${actuallyDeleted} resources)`,
      results: results
    });
    
    res.json({
      success: true,
      message: actuallyDeleted > 0 
        ? `Successfully deleted ${actuallyDeleted} resource(s)` 
        : 'No resources found to delete (may already be deleted)',
      deletedResources: deletedResources,
      results: results,
      modelTag: modelTag,
      actuallyDeleted: actuallyDeleted
    });
    
  } catch (error) {
    console.error('Undeploy error:', error);
    
    broadcast({
      type: 'undeployment',
      status: 'error',
      message: `Failed to undeploy ${req.body.modelTag}: ${error.message}`
    });
    
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 获取部署详细信息（包含模型元数据）
app.get('/api/deployment-details', async (req, res) => {
  try {
    console.log('Fetching deployment details with metadata...');
    
    // 获取所有deployment
    const deploymentsOutput = await executeKubectl('get deployments -o json');
    const deployments = JSON.parse(deploymentsOutput);
    
    // 获取所有service
    const servicesOutput = await executeKubectl('get services -o json');
    const services = JSON.parse(servicesOutput);
    
    // 过滤出模型相关的部署并提取元数据
    const modelDeployments = deployments.items
      .filter(deployment => 
        deployment.metadata.name.includes('vllm') || 
        deployment.metadata.name.includes('olm') ||
        deployment.metadata.name.includes('inference')
      )
      .map(deployment => {
        const labels = deployment.metadata.labels || {};
        const appLabel = labels.app;
        
        // 查找对应的service
        const matchingService = services.items.find(service => 
          service.spec.selector?.app === appLabel
        );
        
        // 从标签中提取模型信息
        const modelType = labels['model-type'] || 'unknown';
        const encodedModelId = labels['model-id'] || 'unknown';
        const modelTag = labels['model-tag'] || 'unknown';
        
        // 确定最终的模型ID - 优先从容器命令中提取原始ID
        let modelId = 'unknown';
        
        // 对于VLLM部署，从容器命令中提取原始模型ID
        if (modelType === 'vllm') {
          try {
            const containers = deployment.spec?.template?.spec?.containers || [];
            const vllmContainer = containers.find(c => c.name === 'vllm-openai');
            if (vllmContainer && vllmContainer.command) {
              const command = vllmContainer.command;
              
              // 1. 优先检查新的 vllm serve 格式
              const serveIndex = command.findIndex(arg => arg === 'serve');
              if (serveIndex !== -1 && serveIndex + 1 < command.length) {
                // 检查前一个参数是否是 vllm 相关
                if (serveIndex > 0 && command[serveIndex - 1].includes('vllm')) {
                  const modelPath = command[serveIndex + 1];
                  // 确保不是以 -- 开头的参数
                  if (!modelPath.startsWith('--')) {
                    modelId = modelPath;
                  }
                }
              }
              
              // 2. 如果没找到，检查传统的 --model 参数
              if (modelId === 'unknown') {
                const modelIndex = command.findIndex(arg => arg === '--model');
                if (modelIndex !== -1 && modelIndex + 1 < command.length) {
                  modelId = command[modelIndex + 1]; // 获取--model参数后的值
                }
              }
            }
          } catch (error) {
            console.log('Failed to extract model ID from VLLM command:', error.message);
          }
        }
        
        // 对于Ollama部署，从postStart生命周期钩子中提取模型ID
        if (modelType === 'ollama' && modelId === 'unknown') {
          try {
            const containers = deployment.spec?.template?.spec?.containers || [];
            const ollamaContainer = containers.find(c => c.name === 'ollama');
            if (ollamaContainer && ollamaContainer.lifecycle?.postStart?.exec?.command) {
              const command = ollamaContainer.lifecycle.postStart.exec.command;
              // 查找包含"ollama pull"的命令
              const commandStr = command.join(' ');
              const pullMatch = commandStr.match(/ollama pull ([^\s\\]+)/);
              if (pullMatch) {
                modelId = pullMatch[1]; // 提取模型ID
                console.log('Extracted Ollama model ID from postStart:', modelId);
              }
            }
          } catch (error) {
            console.log('Failed to extract model ID from Ollama postStart command:', error.message);
          }
        }
        
        // 对于无法提取的情况，使用解码逻辑
        if (modelId === 'unknown' && encodedModelId !== 'unknown') {
          modelId = decodeModelIdFromLabel(encodedModelId);
        }
        
        // 获取服务URL
        let serviceUrl = '';
        if (matchingService) {
          const ingress = matchingService.status?.loadBalancer?.ingress?.[0];
          if (ingress) {
            const host = ingress.hostname || ingress.ip;
            const port = matchingService.spec.ports?.[0]?.port || 8000;
            serviceUrl = `http://${host}:${port}`;
          }
        }
        
        return {
          deploymentName: deployment.metadata.name,
          serviceName: matchingService?.metadata.name || 'N/A',
          modelType: modelType,
          modelId: modelId,
          modelTag: modelTag,
          serviceUrl: serviceUrl,
          status: deployment.status.readyReplicas === deployment.spec.replicas ? 'Ready' : 'Pending',
          replicas: deployment.spec.replicas,
          readyReplicas: deployment.status.readyReplicas || 0,
          hasService: !!matchingService,
          isExternal: matchingService?.metadata?.annotations?.['service.beta.kubernetes.io/aws-load-balancer-scheme'] === 'internet-facing'
        };
      });
    
    console.log('Deployment details fetched:', modelDeployments.length, 'deployments');
    res.json(modelDeployments);
    
  } catch (error) {
    console.error('Deployment details fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取已部署的模型列表
app.get('/api/deployments', async (req, res) => {
  try {
    console.log('Fetching deployments...');
    
    // 获取所有deployment
    const deploymentsOutput = await executeKubectl('get deployments -o json');
    const deployments = JSON.parse(deploymentsOutput);
    
    // 获取所有service
    const servicesOutput = await executeKubectl('get services -o json');
    const services = JSON.parse(servicesOutput);
    
    // 过滤出VLLM和Ollama相关的部署
    const modelDeployments = deployments.items.filter(deployment => 
      deployment.metadata.name.includes('vllm') || 
      deployment.metadata.name.includes('olm') ||
      deployment.metadata.name.includes('inference')
    );
    
    // 为每个部署匹配对应的service
    const deploymentList = modelDeployments.map(deployment => {
      const appLabel = deployment.metadata.labels?.app;
      const matchingService = services.items.find(service => 
        service.spec.selector?.app === appLabel
      );
      
      // 从deployment名称提取model tag和类型
      const deploymentName = deployment.metadata.name;
      let modelTag = 'unknown';
      let deploymentType = 'unknown';
      
      if (deploymentName.startsWith('vllm-') && deploymentName.endsWith('-inference')) {
        modelTag = deploymentName.slice(5, -10); // 移除 'vllm-' 前缀和 '-inference' 后缀
        deploymentType = 'VLLM';
      } else if (deploymentName.startsWith('sglang-') && deploymentName.endsWith('-inference')) {
        modelTag = deploymentName.slice(7, -10); // 移除 'sglang-' 前缀和 '-inference' 后缀
        deploymentType = 'SGLANG';
      } else if (deploymentName.startsWith('olm-') && deploymentName.endsWith('-inference')) {
        modelTag = deploymentName.slice(4, -10); // 移除 'olm-' 前缀和 '-inference' 后缀
        deploymentType = 'Ollama';
      }
      
      // 检查是否为external访问
      const isExternal = matchingService?.metadata?.annotations?.['service.beta.kubernetes.io/aws-load-balancer-scheme'] === 'internet-facing';
      
      return {
        modelTag,
        deploymentType,
        deploymentName: deployment.metadata.name,
        serviceName: matchingService?.metadata.name || 'N/A',
        replicas: deployment.spec.replicas,
        readyReplicas: deployment.status.readyReplicas || 0,
        status: deployment.status.readyReplicas === deployment.spec.replicas ? 'Ready' : 'Pending',
        createdAt: deployment.metadata.creationTimestamp,
        hasService: !!matchingService,
        serviceType: matchingService?.spec.type || 'N/A',
        isExternal: isExternal,
        externalIP: matchingService?.status?.loadBalancer?.ingress?.[0]?.hostname || 
                   matchingService?.status?.loadBalancer?.ingress?.[0]?.ip || 'Pending'
      };
    });
    
    console.log('Deployments fetched:', deploymentList.length, 'model deployments');
    res.json(deploymentList);
    
  } catch (error) {
    console.error('Deployments fetch error:', error);
    res.status(500).json({ error: error.message });
  }
});

// 测试模型API（生成cURL命令）
app.post('/api/test-model', async (req, res) => {
  const { serviceUrl, payload } = req.body;
  
  try {
    let parsedPayload;
    
    try {
      parsedPayload = JSON.parse(payload);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid JSON payload' });
    }
    
    const curlCommand = `curl -X POST "${serviceUrl}" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(parsedPayload, null, 2)}'`;
    
    res.json({
      curlCommand,
      fullUrl: serviceUrl,
      message: 'Use the curl command to test your model'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// WebSocket连接处理 - 优化版本，减少日志污染
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  
  // 发送状态更新的函数
  const sendStatusUpdate = async () => {
    try {
      const [pods, services] = await Promise.all([
        executeKubectl('get pods -o json').then(output => JSON.parse(output).items),
        executeKubectl('get services -o json').then(output => JSON.parse(output).items)
      ]);
      
      const statusData = {
        type: 'status_update',
        pods,
        services,
        timestamp: new Date().toISOString()
      };
      
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(statusData));
        console.log(`📡 Status update sent: ${pods.length} pods, ${services.length} services`);
      }
    } catch (error) {
      console.error('❌ Error fetching status for WebSocket:', error);
    }
  };
  
  // 🚀 优化：只在连接时发送一次初始状态，不再定时发送
  sendStatusUpdate();
  
  // 存储WebSocket连接，用于按需广播
  ws.isAlive = true;
  ws.lastActivity = Date.now();
  
  // 处理WebSocket消息
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      ws.lastActivity = Date.now();
      
      // 🎯 按需处理不同类型的消息
      switch (data.type) {
        case 'request_status_update':
          // 客户端主动请求状态更新
          console.log('📡 Client requested status update');
          sendStatusUpdate();
          break;
          
        case 'start_log_stream':
          console.log(`🔄 Starting log stream for ${data.jobName}/${data.podName}`);
          startLogStream(ws, data.jobName, data.podName);
          break;
          
        case 'stop_log_stream':
          console.log(`⏹️ Stopping log stream for ${data.jobName}/${data.podName}`);
          stopLogStream(ws, data.jobName, data.podName);
          break;
          
        case 'stop_all_log_streams':
          console.log('⏹️ Stopping all log streams');
          stopAllLogStreams(ws);
          break;
          
        case 'ping':
          // 心跳检测
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
          }
          break;
          
        default:
          console.log('📨 Received WebSocket message:', data.type);
      }
    } catch (error) {
      console.error('❌ Error parsing WebSocket message:', error);
    }
  });
  
  // 心跳检测
  ws.on('pong', () => {
    ws.isAlive = true;
    ws.lastActivity = Date.now();
  });
  
  ws.on('close', () => {
    console.log('🔌 WebSocket client disconnected');
    // 清理该连接的所有日志流
    stopAllLogStreams(ws);
  });
  
  ws.on('error', (error) => {
    console.error('❌ WebSocket error:', error);
    // 清理该连接的所有日志流
    stopAllLogStreams(ws);
  });
});

// 🚀 广播函数 - 向所有连接的客户端发送消息
function broadcast(message) {
  const messageStr = JSON.stringify({
    ...message,
    timestamp: new Date().toISOString()
  });
  
  let sentCount = 0;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
      sentCount++;
    }
  });
  
  if (sentCount > 0) {
    console.log(`📡 Broadcast sent to ${sentCount} clients:`, message.type);
  }
}

// 🔄 按需状态更新广播
function broadcastStatusUpdate() {
  const message = {
    type: 'request_status_update_broadcast',
    source: 'server'
  };
  broadcast(message);
}

// ❤️ WebSocket心跳检测 - 每30秒检查一次连接状态
const heartbeatInterval = setInterval(() => {
  const now = Date.now();
  let activeConnections = 0;
  
  wss.clients.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      // 检查连接是否活跃（5分钟内有活动）
      if (now - ws.lastActivity < 300000) {
        ws.ping();
        activeConnections++;
      } else {
        console.log('🔌 Terminating inactive WebSocket connection');
        ws.terminate();
      }
    }
  });
  
  // 只在有连接时输出心跳日志
  if (activeConnections > 0) {
    console.log(`❤️ WebSocket heartbeat: ${activeConnections} active connections`);
  }
}, 30000);

// 🧹 进程清理函数 - 优化版本
process.on('SIGTERM', () => {
  console.log('🛑 Received SIGTERM signal - Server shutting down gracefully...');
  gracefulShutdown('SIGTERM');
});

process.on('SIGINT', () => {
  console.log('🛑 Received SIGINT signal (Ctrl+C) - Server shutting down gracefully...');
  gracefulShutdown('SIGINT');
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  console.error('Stack trace:', error.stack);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// 优雅关闭函数
function gracefulShutdown(signal) {
  console.log(`🔄 Starting graceful shutdown (signal: ${signal})...`);
  
  // 清理WebSocket心跳检测
  if (typeof heartbeatInterval !== 'undefined') {
    clearInterval(heartbeatInterval);
    console.log('✅ WebSocket heartbeat interval cleared');
  }
  
  // 关闭WebSocket服务器
  if (wss) {
    console.log(`📡 Closing WebSocket server (${wss.clients.size} active connections)...`);
    wss.close(() => {
      console.log('✅ WebSocket server closed');
    });
  }
  
  // 清理活跃的日志流
  if (activeLogStreams && activeLogStreams.size > 0) {
    console.log(`🧹 Cleaning up ${activeLogStreams.size} active log streams...`);
    activeLogStreams.clear();
    console.log('✅ Log streams cleaned up');
  }
  
  console.log('✅ Graceful shutdown completed');
  
  // 给一些时间让清理完成，然后退出
  setTimeout(() => {
    process.exit(signal === 'uncaughtException' || signal === 'unhandledRejection' ? 1 : 0);
  }, 1000);
}

// 启动pod日志流
function startLogStream(ws, jobName, podName) {
  const streamKey = `${jobName}-${podName}`;
  
  // 如果已经有该pod的日志流，先停止它
  if (activeLogStreams.has(streamKey)) {
    stopLogStream(ws, jobName, podName);
  }
  
  console.log(`Starting log stream for pod: ${podName} in job: ${jobName}`);
  
  // 创建日志文件路径
  const logFilePath = ensureLogDirectory(jobName, podName);
  const logStream = fs.createWriteStream(logFilePath, { flags: 'a' });
  
  // 启动kubectl logs命令
  const logProcess = spawn('kubectl', ['logs', '-f', podName], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  
  // 存储进程引用和文件流
  activeLogStreams.set(streamKey, {
    process: logProcess,
    logStream: logStream,
    ws: ws,
    jobName: jobName,
    podName: podName
  });
  
  // 处理标准输出
  logProcess.stdout.on('data', (data) => {
    const logLine = data.toString();
    const timestamp = new Date().toISOString();
    
    // 写入文件（带时间戳）
    logStream.write(`[${timestamp}] ${logLine}`);
    
    // 发送到前端
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'log_data',
        jobName: jobName,
        podName: podName,
        data: logLine,
        timestamp: timestamp
      }));
    }
  });
  
  // 处理标准错误
  logProcess.stderr.on('data', (data) => {
    const errorLine = data.toString();
    const timestamp = new Date().toISOString();
    
    console.error(`Log stream error for ${podName}:`, errorLine);
    
    // 写入错误到文件
    logStream.write(`[${timestamp}] ERROR: ${errorLine}`);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'log_error',
        jobName: jobName,
        podName: podName,
        error: errorLine,
        timestamp: timestamp
      }));
    }
  });
  
  // 处理进程退出
  logProcess.on('close', (code) => {
    console.log(`Log stream for ${podName} closed with code: ${code}`);
    
    // 关闭文件流
    logStream.end();
    activeLogStreams.delete(streamKey);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'log_stream_closed',
        jobName: jobName,
        podName: podName,
        code: code,
        timestamp: new Date().toISOString()
      }));
    }
  });
  
  // 处理进程错误
  logProcess.on('error', (error) => {
    console.error(`Log stream process error for ${podName}:`, error);
    
    // 关闭文件流
    logStream.end();
    activeLogStreams.delete(streamKey);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'log_stream_error',
        jobName: jobName,
        podName: podName,
        error: error.message,
        timestamp: new Date().toISOString()
      }));
    }
  });
}

// 停止特定pod的日志流
function stopLogStream(ws, jobName, podName) {
  const streamKey = `${jobName}-${podName}`;
  const streamInfo = activeLogStreams.get(streamKey);
  
  if (streamInfo) {
    console.log(`Stopping log stream for pod: ${podName}`);
    streamInfo.process.kill('SIGTERM');
    
    // 关闭文件流
    if (streamInfo.logStream) {
      streamInfo.logStream.end();
    }
    
    activeLogStreams.delete(streamKey);
    
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'log_stream_stopped',
        jobName: jobName,
        podName: podName,
        timestamp: new Date().toISOString()
      }));
    }
  }
}

// 停止某个WebSocket连接的所有日志流
function stopAllLogStreams(ws) {
  const streamsToStop = [];
  
  // 从统一日志流中移除该WebSocket连接
  unifiedLogStreams.forEach((stream, streamKey) => {
    if (stream.webSockets.has(ws)) {
      const [jobName, podName] = streamKey.split('-');
      streamsToStop.push({ jobName, podName });
    }
  });
  
  // 移除WebSocket连接
  streamsToStop.forEach(({ jobName, podName }) => {
    removeWebSocketFromLogStream(ws, jobName, podName);
  });
  
  if (streamsToStop.length > 0) {
    console.log(`🧹 Cleaned up ${streamsToStop.length} log streams for disconnected WebSocket`);
  }
}

const S3StorageManager = require('./s3-storage-manager');
const s3StorageManager = new S3StorageManager();

// S3存储管理API
app.get('/api/s3-storages', async (req, res) => {
  const result = await s3StorageManager.getStorages();
  res.json(result);
});

// 获取S3存储默认值
app.get('/api/s3-storage-defaults', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    
    let defaultBucket = '';
    
    // 从容器中的 /s3-workspace-metadata 路径读取默认bucket
    try {
      const metadataPath = '/s3-workspace-metadata';
      if (fs.existsSync(metadataPath)) {
        const files = fs.readdirSync(metadataPath);
        const bucketFile = files.find(file => file.startsWith('CURRENT_BUCKET_'));
        if (bucketFile) {
          defaultBucket = bucketFile.replace('CURRENT_BUCKET_', '');
        }
      }
    } catch (error) {
      console.log('Could not read s3-workspace-metadata:', error.message);
    }
    
    res.json({
      success: true,
      defaults: {
        name: 's3-claim',
        bucketName: defaultBucket,
        region: 'us-west-2'
      }
    });
  } catch (error) {
    console.error('Error getting S3 storage defaults:', error);
    res.json({
      success: false,
      error: error.message,
      defaults: {
        name: 's3-claim',
        bucketName: '',
        region: 'us-west-2'
      }
    });
  }
});

app.post('/api/s3-storages', async (req, res) => {
  const result = await s3StorageManager.createStorage(req.body);
  if (result.success) {
    broadcast({
      type: 's3_storage_created',
      status: 'success',
      message: `S3 storage ${req.body.name} created successfully`
    });
  }
  res.json(result);
});

app.delete('/api/s3-storages/:name', async (req, res) => {
  const result = await s3StorageManager.deleteStorage(req.params.name);
  if (result.success) {
    broadcast({
      type: 's3_storage_deleted',
      status: 'success',
      message: `S3 storage ${req.params.name} deleted successfully`
    });
  }
  res.json(result);
});

// 增强的模型下载API
app.post('/api/download-model-enhanced', async (req, res) => {
  try {
    const { modelId, hfToken, resources, s3Storage } = req.body;
    
    if (!modelId) {
      return res.json({ success: false, error: 'Model ID is required' });
    }

    console.log(`🚀 Starting enhanced model download: ${modelId}`);
    console.log(`📊 Resources: CPU=${resources.cpu}, Memory=${resources.memory}GB`);
    console.log(`💾 S3 Storage: ${s3Storage}`);

    // 生成增强的下载Job
    const jobResult = await s3StorageManager.generateEnhancedDownloadJob({
      modelId,
      hfToken,
      resources,
      s3Storage
    });

    if (!jobResult.success) {
      return res.json({ success: false, error: jobResult.error });
    }

    // 确保deployments目录存在
    const deploymentsDir = path.join(__dirname, '..', 'deployments');
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    // 保存生成的YAML文件到deployments目录
    const modelTag = modelId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const deploymentFile = path.join(deploymentsDir, `enhanced-model-download-${modelTag}-${timestamp}.yaml`);
    await fs.writeFile(deploymentFile, jobResult.yamlContent);
    
    console.log(`📁 Saved deployment template: ${deploymentFile}`);

    // 应用Job到Kubernetes
    const tempFile = `/tmp/enhanced-download-job-${Date.now()}.yaml`;
    fs.writeFileSync(tempFile, jobResult.yamlContent);

    exec(`kubectl apply -f ${tempFile}`, (error, stdout, stderr) => {
      fs.removeSync(tempFile);
      
      if (error) {
        console.error('❌ Failed to create enhanced download job:', stderr);
        broadcast({
          type: 'model_download',
          status: 'error',
          message: `Failed to start enhanced model download: ${stderr}`
        });
        return res.json({ success: false, error: stderr });
      }

      console.log('✅ Enhanced model download job created successfully');
      broadcast({
        type: 'model_download',
        status: 'success',
        message: `Enhanced model download started: ${modelId}`,
        jobName: jobResult.jobName
      });

      res.json({ 
        success: true, 
        message: 'Enhanced model download job created successfully',
        jobName: jobResult.jobName,
        deploymentFile: path.basename(deploymentFile)
      });
    });

  } catch (error) {
    console.error('❌ Error in enhanced model download:', error);
    res.json({ success: false, error: error.message });
  }
});

// 模型下载API
app.post('/api/download-model', async (req, res) => {
  try {
    const { modelId, hfToken } = req.body;
    
    if (!modelId) {
      return res.json({ success: false, error: 'Model ID is required' });
    }
    
    console.log(`Starting model download for: ${modelId}`);
    
    // 读取HF下载模板
    const templatePath = path.join(__dirname, '..', 'templates', 'hf-download-template.yaml');
    let template = await fs.readFile(templatePath, 'utf8');
    
    // 生成模型标签
    const modelTag = generateModelTag(modelId);
    
    // 替换基本变量
    const replacements = {
      'HF_MODEL_ID': modelId,
      'MODEL_TAG': modelTag
    };
    
    // 处理HF Token环境变量
    if (hfToken && hfToken.trim()) {
      const tokenEnv = `
        - name: HF_TOKEN
          value: "${hfToken.trim()}"`;
      template = template.replace('env:HF_TOKEN_ENV', `env:${tokenEnv}`);
      
      // 同时在hf download命令中启用token
      template = template.replace('#  --token=$HF_TOKEN', '          --token=$HF_TOKEN \\');
    } else {
      // 移除HF_TOKEN_ENV占位符，保留其他环境变量
      template = template.replace('      env:HF_TOKEN_ENV', '      env:');
    }
    
    // 替换其他变量
    Object.keys(replacements).forEach(key => {
      const regex = new RegExp(key, 'g');
      template = template.replace(regex, replacements[key]);
    });
    
    // 确保deployments目录存在
    const deploymentsDir = path.join(__dirname, '..', 'deployments');
    if (!fs.existsSync(deploymentsDir)) {
      fs.mkdirSync(deploymentsDir, { recursive: true });
    }
    
    // 保存生成的YAML文件
    const deploymentFile = path.join(deploymentsDir, `model-download-${modelTag}.yaml`);
    await fs.writeFile(deploymentFile, template);
    
    console.log(`Generated deployment file: ${deploymentFile}`);
    
    // 应用到Kubernetes
    try {
      const result = await executeKubectl(`apply -f "${deploymentFile}"`);
      console.log('kubectl apply result:', result);
      
      // 广播部署状态更新
      broadcast({
        type: 'model_download',
        status: 'success',
        message: `Model download started for ${modelId}`,
        modelId: modelId,
        modelTag: modelTag
      });
      
      res.json({ 
        success: true, 
        message: `Model download initiated for ${modelId}`,
        modelTag: modelTag
      });
      
    } catch (kubectlError) {
      console.error('kubectl apply error:', kubectlError);
      res.json({ 
        success: false, 
        error: `Failed to apply deployment: ${kubectlError.error || kubectlError}` 
      });
    }
    
  } catch (error) {
    console.error('Model download error:', error);
    res.json({ success: false, error: error.message });
  }
});

// S3存储信息API - 从s3-pv PersistentVolume获取桶信息
app.get('/api/s3-storage', async (req, res) => {
  try {
    const { storage } = req.query;
    console.log(`📦 Fetching S3 storage content for: ${storage || 'default'}`);
    
    // 获取存储配置
    const storageResult = await s3StorageManager.getStorages();
    if (!storageResult.success) {
      return res.json({ success: false, error: 'Failed to get storage configurations' });
    }
    
    // 找到对应的存储配置
    const selectedStorage = storageResult.storages.find(s => s.pvcName === storage) || 
                           storageResult.storages.find(s => s.pvcName === 's3-claim') ||
                           storageResult.storages[0];
    
    if (!selectedStorage) {
      return res.json({ 
        success: true, 
        data: [], 
        bucketInfo: { bucket: 'No storage configured', region: 'Unknown' }
      });
    }
    
    console.log(`📦 Using storage: ${selectedStorage.name} -> ${selectedStorage.bucketName}`);
    
    // 使用AWS CLI获取S3内容
    let s3Data = [];
    const region = selectedStorage.region || 'us-west-2';
    const awsCommand = `aws s3 ls s3://${selectedStorage.bucketName}/ --region ${region}`;
    
    console.log(`🔍 Executing: ${awsCommand}`);
    
    try {
      const { exec } = require('child_process');
      const { promisify } = require('util');
      const execAsync = promisify(exec);
      
      const { stdout, stderr } = await execAsync(awsCommand);
      
      if (stderr) {
        console.warn('AWS CLI stderr:', stderr);
      }
      
      console.log('AWS CLI stdout:', stdout);
      
      if (stdout) {
        const lines = stdout.split('\n').filter(line => line.trim());
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;
          
          if (trimmed.startsWith('PRE ')) {
            // 文件夹格式: "PRE folder-name/"
            const folderName = trimmed.substring(4); // 去掉 "PRE "
            s3Data.push({
              key: folderName,
              type: 'folder',
              size: null,
              lastModified: new Date().toISOString()
            });
          } else {
            // 文件格式: "2025-08-15 09:18:57 0 filename"
            const parts = trimmed.split(/\s+/);
            if (parts.length >= 4) {
              const date = parts[0];
              const time = parts[1];
              const size = parts[2];
              const name = parts.slice(3).join(' ');
              
              s3Data.push({
                key: name,
                type: 'file',
                size: parseInt(size) || 0,
                lastModified: new Date(`${date} ${time}`).toISOString(),
                storageClass: 'STANDARD'
              });
            }
          }
        }
      }
      
      console.log(`📊 Found ${s3Data.length} items in S3`);
      
    } catch (awsError) {
      console.error('AWS CLI error:', awsError);
      throw new Error(`Failed to list S3 contents: ${awsError.message}`);
    }
    
    res.json({
      success: true,
      data: s3Data,
      bucketInfo: {
        bucket: selectedStorage.bucketName,
        region: selectedStorage.region || 'Unknown',
        pvcName: selectedStorage.pvcName
      }
    });
    
  } catch (error) {
    console.error('❌ Error fetching S3 storage:', error);
    res.json({ success: false, error: error.message });
  }
});
app.get('/api/cluster/mlflow-info', (req, res) => {
  try {
    // 使用多集群管理器获取活跃集群的MLflow信息
    const ClusterManager = require('./cluster-manager');
    const clusterManager = new ClusterManager();
    const activeCluster = clusterManager.getActiveCluster();
    
    if (!activeCluster) {
      return res.json({
        success: false,
        error: 'No active cluster found'
      });
    }

    // 从活跃集群的配置目录读取MLflow信息
    const configDir = clusterManager.getClusterConfigDir(activeCluster);
    const mlflowInfoPath = path.join(configDir, 'mlflow-server-info.json');
    
    if (fs.existsSync(mlflowInfoPath)) {
      const fileContent = fs.readFileSync(mlflowInfoPath, 'utf8').trim();
      
      // 检查文件是否为空
      if (!fileContent) {
        return res.json({
          success: true,
          data: {
            status: 'not_found',
            error: 'MLflow server info file is empty',
            clusterTag: activeCluster
          }
        });
      }
      
      let mlflowInfo;
      try {
        mlflowInfo = JSON.parse(fileContent);
      } catch (parseError) {
        return res.json({
          success: true,
          data: {
            status: 'error',
            error: 'Invalid JSON in MLflow server info file',
            clusterTag: activeCluster
          }
        });
      }
      
      // 检查解析后的对象是否为空或无效
      if (!mlflowInfo || Object.keys(mlflowInfo).length === 0) {
        return res.json({
          success: true,
          data: {
            status: 'not_found',
            error: 'MLflow server info is empty',
            clusterTag: activeCluster
          }
        });
      }
      
      // 返回前端期望的数据结构
      res.json({
        success: true,
        data: {
          status: 'found',
          trackingServerArn: mlflowInfo.TrackingServerArn,
          trackingServerName: mlflowInfo.TrackingServerName,
          trackingServerUrl: mlflowInfo.TrackingServerUrl,
          trackingServerStatus: mlflowInfo.TrackingServerStatus,
          isActive: mlflowInfo.IsActive,
          mlflowVersion: mlflowInfo.MlflowVersion,
          artifactStoreUri: mlflowInfo.ArtifactStoreUri,
          trackingServerSize: mlflowInfo.TrackingServerSize,
          roleArn: mlflowInfo.RoleArn,
          creationTime: mlflowInfo.CreationTime,
          clusterTag: activeCluster,
          rawData: mlflowInfo // 保留原始数据以备调试
        }
      });
    } else {
      res.json({
        success: true,
        data: {
          status: 'not_found',
          error: `MLflow server info not found for cluster: ${activeCluster}`,
          clusterTag: activeCluster
        }
      });
    }
  } catch (error) {
    console.error('Error reading MLflow server info:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// 清除状态缓存 API

// 获取 Step 1 状态 API

// 获取日志内容 API
// 旧的日志API - 已被多集群API替代
/*
app.get('/api/cluster/logs/:step', (req, res) => {
  try {
    const { step } = req.params;
    const { offset = 0 } = req.query;
    
    const logContent = logManager.getCurrentLogContent(step);
    const statusFile = path.join(logManager.metadataDir, `${step}_status.json`);
    
    let status = { status: 'idle' };
    if (fs.existsSync(statusFile)) {
      status = JSON.parse(fs.readFileSync(statusFile, 'utf8'));
    }

    // 支持增量读取（从指定偏移量开始）
    const newContent = logContent.slice(parseInt(offset));
    
    res.json({
      success: true,
      data: {
        content: newContent,
        fullContent: logContent,
        totalLength: logContent.length,
        status: status.status,
        timestamp: status.timestamp,
        logId: status.logId
      }
    });

  } catch (error) {
    console.error('Error reading logs:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});
*/

// 获取历史日志列表
app.get('/api/cluster/logs-history', (req, res) => {
  try {
    const logFiles = fs.readdirSync(logManager.logsDir)
      .filter(file => file.endsWith('.log'))
      .map(file => {
        const filePath = path.join(logManager.logsDir, file);
        const stats = fs.statSync(filePath);
        const [timestamp, step] = file.replace('.log', '').split('_');
        
        return {
          filename: file,
          step: step,
          timestamp: timestamp.replace(/_/g, 'T').replace(/-/g, ':'),
          size: stats.size,
          created: stats.birthtime,
          modified: stats.mtime
        };
      })
      .sort((a, b) => new Date(b.created) - new Date(a.created));

    res.json({
      success: true,
      data: logFiles
    });

  } catch (error) {
    console.error('Error getting log history:', error);
    res.json({
      success: false,
      error: error.message
    });
  }
});

// 获取 CloudFormation 堆栈状态 - 从 init_envs 自动读取堆栈名称
// ==================== 多集群管理 API ====================
// 引入多集群管理模块
const MultiClusterAPIs = require('./multi-cluster-apis');
const MultiClusterStatus = require('./multi-cluster-status');

const multiClusterAPIs = new MultiClusterAPIs();
const multiClusterStatus = new MultiClusterStatus();

// 多集群管理API
app.get('/api/multi-cluster/list', (req, res) => multiClusterAPIs.handleGetClusters(req, res));
app.post('/api/multi-cluster/switch', (req, res) => multiClusterAPIs.handleSwitchCluster(req, res));
app.post('/api/multi-cluster/switch-kubectl', (req, res) => multiClusterAPIs.handleSwitchKubectlConfig(req, res));

// 集群导入API
app.post('/api/cluster/import', (req, res) => multiClusterAPIs.handleImportCluster(req, res));
app.post('/api/cluster/test-connection', (req, res) => multiClusterAPIs.handleTestConnection(req, res));

// 重写现有的集群API以支持多集群
app.post('/api/cluster/save-config', (req, res) => multiClusterAPIs.handleSaveConfig(req, res));
app.post('/api/cluster/launch', (req, res) => multiClusterAPIs.handleLaunch(req, res));
app.post('/api/cluster/configure', (req, res) => multiClusterAPIs.handleConfigure(req, res));
app.get('/api/cluster/logs/:step', (req, res) => multiClusterAPIs.handleGetLogs(req, res));
app.get('/api/cluster/logs-history', (req, res) => multiClusterAPIs.handleGetLogsHistory(req, res));
app.post('/api/cluster/clear-status-cache', (req, res) => multiClusterAPIs.handleClearStatusCache(req, res));

// 重写状态检查API以支持多集群
app.get('/api/cluster/step1-status', (req, res) => multiClusterStatus.handleStep1Status(req, res));
app.get('/api/cluster/step2-status', (req, res) => multiClusterStatus.handleStep2Status(req, res));
app.get('/api/cluster/cloudformation-status', (req, res) => multiClusterStatus.handleCloudFormationStatus(req, res));

// 节点组管理API
app.get('/api/cluster/nodegroups', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    const path = require('path');
    
    const ClusterManager = require('./cluster-manager');
    const clusterManager = new ClusterManager();
    const activeClusterName = clusterManager.getActiveCluster();
    
    if (!activeClusterName) {
      return res.status(400).json({ error: 'No active cluster found' });
    }

    // 读取集群配置文件
    const configDir = clusterManager.getClusterConfigDir(activeClusterName);
    const initEnvsPath = path.join(configDir, 'init_envs');
    
    if (!fs.existsSync(initEnvsPath)) {
      return res.status(400).json({ error: 'Cluster configuration file not found' });
    }

    // 解析init_envs文件 - 使用shell source方式
    const getEnvVar = async (varName) => {
      const cmd = `source ${initEnvsPath} && echo $${varName}`;
      const result = await execAsync(cmd, { shell: '/bin/bash' });
      return result.stdout.trim();
    };
    
    const clusterName = await getEnvVar('EKS_CLUSTER_NAME') || activeClusterName;
    const region = await getEnvVar('AWS_REGION') || 'us-west-2';
    
    // 获取EKS节点组
    const eksCmd = `aws eks list-nodegroups --cluster-name ${clusterName} --region ${region} --output json`;
    const eksResult = await execAsync(eksCmd);
    const eksData = JSON.parse(eksResult.stdout);
    
    const eksNodeGroups = [];
    for (const nodegroupName of eksData.nodegroups || []) {
      const detailCmd = `aws eks describe-nodegroup --cluster-name ${clusterName} --nodegroup-name ${nodegroupName} --region ${region} --output json`;
      const detailResult = await execAsync(detailCmd);
      const nodegroup = JSON.parse(detailResult.stdout).nodegroup;
      
      // 获取实例类型，如果为null则从Launch Template获取
      let instanceTypes = nodegroup.instanceTypes;
      if (!instanceTypes || instanceTypes.length === 0) {
        try {
          if (nodegroup.launchTemplate && nodegroup.launchTemplate.id) {
            const ltCmd = `aws ec2 describe-launch-template-versions --launch-template-id ${nodegroup.launchTemplate.id} --region ${region} --query 'LaunchTemplateVersions[0].LaunchTemplateData.InstanceType' --output json`;
            const ltResult = await execAsync(ltCmd);
            const instanceType = JSON.parse(ltResult.stdout);
            if (instanceType) {
              instanceTypes = [instanceType];
            }
          }
        } catch (ltError) {
          console.warn('Failed to get instance type from launch template:', ltError.message);
        }
      }
      
      eksNodeGroups.push({
        name: nodegroup.nodegroupName,
        status: nodegroup.status,
        instanceTypes: instanceTypes || [],
        capacityType: nodegroup.capacityType,
        scalingConfig: nodegroup.scalingConfig,
        amiType: nodegroup.amiType,
        subnets: nodegroup.subnets,
        nodeRole: nodegroup.nodeRole
      });
    }
    
    // 获取HyperPod实例组
    const hyperPodGroups = [];
    try {
      const hpClusterName = clusterName.replace('eks-cluster-', 'hp-cluster-');
      const hpCmd = `aws sagemaker describe-cluster --cluster-name ${hpClusterName} --region ${region} --output json`;
      const hpResult = await execAsync(hpCmd);
      const hpData = JSON.parse(hpResult.stdout);
      
      for (const instanceGroup of hpData.InstanceGroups || []) {
        hyperPodGroups.push({
          clusterName: hpClusterName,
          clusterArn: hpData.ClusterArn,
          name: instanceGroup.InstanceGroupName,
          status: instanceGroup.Status,
          instanceType: instanceGroup.InstanceType,
          currentCount: instanceGroup.CurrentCount,
          targetCount: instanceGroup.TargetCount,
          executionRole: instanceGroup.ExecutionRole
        });
      }
    } catch (hpError) {
      console.log('No HyperPod cluster found or error:', hpError.message);
    }
    
    res.json({
      eksNodeGroups,
      hyperPodInstanceGroups: hyperPodGroups
    });
  } catch (error) {
    console.error('Error fetching node groups:', error);
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/cluster/nodegroups/:name/scale', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    const path = require('path');
    
    const { name } = req.params;
    const { minSize, maxSize, desiredSize } = req.body;
    
    const ClusterManager = require('./cluster-manager');
    const clusterManager = new ClusterManager();
    const activeClusterName = clusterManager.getActiveCluster();
    
    if (!activeClusterName) {
      return res.status(400).json({ error: 'No active cluster found' });
    }

    // 读取集群配置文件
    const configDir = clusterManager.getClusterConfigDir(activeClusterName);
    const initEnvsPath = path.join(configDir, 'init_envs');
    
    if (!fs.existsSync(initEnvsPath)) {
      return res.status(400).json({ error: 'Cluster configuration file not found' });
    }

    // 解析init_envs文件 - 使用shell source方式
    const getEnvVar = async (varName) => {
      const cmd = `source ${initEnvsPath} && echo $${varName}`;
      const result = await execAsync(cmd, { shell: '/bin/bash' });
      return result.stdout.trim();
    };
    
    const clusterName = await getEnvVar('EKS_CLUSTER_NAME') || activeClusterName;
    const region = await getEnvVar('AWS_REGION') || 'us-west-2';
    
    const cmd = `aws eks update-nodegroup-config --cluster-name ${clusterName} --nodegroup-name ${name} --scaling-config minSize=${minSize},maxSize=${maxSize},desiredSize=${desiredSize} --region ${region}`;
    
    await execAsync(cmd);
    
    // WebSocket通知
    broadcast({
      type: 'nodegroup_updated',
      status: 'success',
      message: `EKS node group ${name} scaling updated successfully`
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating EKS node group:', error);
    broadcast({
      type: 'nodegroup_updated',
      status: 'error',
      message: `Failed to update EKS node group: ${error.message}`
    });
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/cluster/hyperpod/instances/:name/scale', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    const path = require('path');
    
    const { name } = req.params;
    const { targetCount } = req.body;
    
    const ClusterManager = require('./cluster-manager');
    const clusterManager = new ClusterManager();
    const activeClusterName = clusterManager.getActiveCluster();
    
    if (!activeClusterName) {
      return res.status(400).json({ error: 'No active cluster found' });
    }

    // 读取集群配置文件
    const configDir = clusterManager.getClusterConfigDir(activeClusterName);
    const initEnvsPath = path.join(configDir, 'init_envs');
    
    if (!fs.existsSync(initEnvsPath)) {
      return res.status(400).json({ error: 'Cluster configuration file not found' });
    }

    // 解析init_envs文件 - 使用shell source方式
    const getEnvVar = async (varName) => {
      const cmd = `source ${initEnvsPath} && echo $${varName}`;
      const result = await execAsync(cmd, { shell: '/bin/bash' });
      return result.stdout.trim();
    };
    
    const clusterName = await getEnvVar('EKS_CLUSTER_NAME') || activeClusterName;
    const region = await getEnvVar('AWS_REGION') || 'us-west-2';
    const hpClusterName = clusterName.replace('eks-cluster-', 'hp-cluster-');
    
    // HyperPod需要完整的实例组配置，不能只更新InstanceCount
    // 我们需要先获取当前配置，然后更新InstanceCount
    const getCmd = `aws sagemaker describe-cluster --cluster-name ${hpClusterName} --region ${region}`;
    const getResult = await execAsync(getCmd);
    const clusterData = JSON.parse(getResult.stdout);
    
    // 找到要更新的实例组
    const instanceGroup = clusterData.InstanceGroups.find(ig => ig.InstanceGroupName === name);
    if (!instanceGroup) {
      throw new Error(`Instance group ${name} not found`);
    }
    
    // 构建更新命令，使用完整的实例组配置
    const updateInstanceGroup = {
      InstanceGroupName: instanceGroup.InstanceGroupName,
      InstanceType: instanceGroup.InstanceType,
      InstanceCount: targetCount,
      ExecutionRole: instanceGroup.ExecutionRole,
      LifeCycleConfig: instanceGroup.LifeCycleConfig
    };
    
    // 添加可选参数
    if (instanceGroup.ThreadsPerCore) {
      updateInstanceGroup.ThreadsPerCore = instanceGroup.ThreadsPerCore;
    }
    if (instanceGroup.InstanceStorageConfigs) {
      updateInstanceGroup.InstanceStorageConfigs = instanceGroup.InstanceStorageConfigs;
    }
    
    const cmd = `aws sagemaker update-cluster --cluster-name ${hpClusterName} --instance-groups '${JSON.stringify(updateInstanceGroup)}' --region ${region}`;
    
    await execAsync(cmd);
    
    // WebSocket通知
    broadcast({
      type: 'nodegroup_updated',
      status: 'success',
      message: `HyperPod instance group ${name} scaling updated successfully`
    });
    
    res.json({ success: true });
  } catch (error) {
    console.error('Error updating HyperPod instance group:', error);
    broadcast({
      type: 'nodegroup_updated',
      status: 'error',
      message: `Failed to update HyperPod instance group: ${error.message}`
    });
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/cluster/hyperpod/update-software', async (req, res) => {
  try {
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    const path = require('path');
    
    const { clusterArn } = req.body;
    
    const ClusterManager = require('./cluster-manager');
    const clusterManager = new ClusterManager();
    const activeClusterName = clusterManager.getActiveCluster();
    
    if (!activeClusterName) {
      return res.status(400).json({ error: 'No active cluster found' });
    }

    // 读取集群配置文件获取region
    const configDir = clusterManager.getClusterConfigDir(activeClusterName);
    const initEnvsPath = path.join(configDir, 'init_envs');
    
    if (!fs.existsSync(initEnvsPath)) {
      return res.status(400).json({ error: 'Cluster configuration file not found' });
    }

    // 解析init_envs文件 - 使用shell source方式
    const getEnvVar = async (varName) => {
      const cmd = `source ${initEnvsPath} && echo $${varName}`;
      const result = await execAsync(cmd, { shell: '/bin/bash' });
      return result.stdout.trim();
    };
    
    const region = await getEnvVar('AWS_REGION') || 'us-west-2';

    // 执行update-cluster-software命令
    const updateCmd = `aws sagemaker update-cluster-software --cluster-name ${clusterArn} --region ${region}`;
    
    await execAsync(updateCmd);
    
    broadcast({
      type: 'hyperpod_software_update',
      status: 'success',
      message: '✅ HyperPod cluster software update started successfully',
      clusterArn: clusterArn
    });

    res.json({ success: true, message: 'Cluster software update initiated successfully' });
  } catch (error) {
    console.error('Error updating HyperPod cluster software:', error);
    
    broadcast({
      type: 'hyperpod_software_update',
      status: 'error',
      message: `❌ HyperPod software update failed: ${error.message}`
    });

    res.status(500).json({ error: error.message });
  }
});

console.log('Multi-cluster management APIs loaded');

// 引入CIDR生成工具
const CidrGenerator = require('./utils/cidrGenerator');
const CloudFormationManager = require('./utils/cloudFormationManager');
const ClusterDependencyManager = require('./utils/clusterDependencyManager');
const ClusterManager = require('./cluster-manager');
const clusterManager = new ClusterManager();

// CIDR生成相关API
app.get('/api/cluster/generate-cidr', async (req, res) => {
  try {
    const { region, excludeCidr } = req.query;
    
    if (!region) {
      return res.status(400).json({ error: 'AWS region is required' });
    }
    
    const cidr = await CidrGenerator.generateUniqueCidr(region, excludeCidr);
    
    res.json({
      success: true,
      cidr,
      region,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating CIDR:', error);
    res.status(500).json({ error: error.message });
  }
});

// 生成完整CIDR配置
app.post('/api/cluster/generate-cidr-config', async (req, res) => {
  try {
    const { region, customVpcCidr } = req.body;
    
    if (!region) {
      return res.status(400).json({ error: 'AWS region is required' });
    }
    
    const cidrConfig = await CidrGenerator.generateFullCidrConfiguration(region, customVpcCidr);
    
    res.json({
      success: true,
      ...cidrConfig
    });
  } catch (error) {
    console.error('Error generating CIDR configuration:', error);
    res.status(500).json({ error: error.message });
  }
});

// 验证CIDR格式和冲突
app.post('/api/cluster/validate-cidr', async (req, res) => {
  try {
    const { cidr, region } = req.body;
    
    if (!cidr || !region) {
      return res.status(400).json({ error: 'CIDR and region are required' });
    }
    
    // 验证格式
    const isValidFormat = CidrGenerator.validateCidrFormat(cidr);
    if (!isValidFormat) {
      return res.json({
        success: false,
        valid: false,
        error: 'Invalid CIDR format'
      });
    }
    
    // 检查冲突
    const hasConflict = await CidrGenerator.checkCidrConflict(cidr, region);
    
    res.json({
      success: true,
      valid: !hasConflict,
      conflict: hasConflict,
      message: hasConflict ? 'CIDR conflicts with existing VPC' : 'CIDR is available'
    });
  } catch (error) {
    console.error('Error validating CIDR:', error);
    res.status(500).json({ error: error.message });
  }
});

console.log('CIDR generation APIs loaded');

// EKS集群创建相关API
app.post('/api/cluster/create-eks', async (req, res) => {
  try {
    const { clusterTag, awsRegion, customVpcCidr } = req.body;
    
    // 验证必填字段
    if (!clusterTag || !awsRegion) {
      return res.status(400).json({ error: 'Missing required fields: clusterTag and awsRegion' });
    }
    
    // 生成CIDR配置
    const cidrConfig = await CidrGenerator.generateFullCidrConfiguration(awsRegion, customVpcCidr);
    
    // 立即创建集群目录和状态记录（在CloudFormation调用前）
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const stackName = `full-stack-${clusterTag}-${timestamp}`;
    
    const clusterConfig = {
      clusterTag,
      awsRegion,
      customVpcCidr: customVpcCidr || 'auto-generated'
    };
    
    // 创建集群目录结构
    clusterManager.createClusterDirs(clusterTag);
    
    // 立即保存用户输入和CIDR配置
    const metadataDir = clusterManager.getClusterMetadataDir(clusterTag);
    const fs = require('fs');
    const path = require('path');
    
    // 添加到creating-clusters跟踪文件
    const creatingClustersPath = path.join(__dirname, '../managed_clusters_info/creating-clusters.json');
    let creatingClusters = {};
    if (fs.existsSync(creatingClustersPath)) {
      creatingClusters = JSON.parse(fs.readFileSync(creatingClustersPath, 'utf8'));
    }
    creatingClusters[clusterTag] = {
      type: 'eks',
      status: 'IN_PROGRESS',
      createdAt: new Date().toISOString(),
      stackName: stackName,
      region: awsRegion
    };
    fs.writeFileSync(creatingClustersPath, JSON.stringify(creatingClusters, null, 2));
    
    // 保存用户输入信息
    fs.writeFileSync(
      path.join(metadataDir, 'user_input.json'),
      JSON.stringify({
        clusterTag,
        awsRegion,
        customVpcCidr: customVpcCidr || null,
        inputAt: new Date().toISOString()
      }, null, 2)
    );
    
    // 保存CIDR配置
    fs.writeFileSync(
      path.join(metadataDir, 'cidr_configuration.json'),
      JSON.stringify(cidrConfig, null, 2)
    );
    
    // 保存创建状态
    fs.writeFileSync(
      path.join(metadataDir, 'creation_status.json'),
      JSON.stringify({
        status: 'IN_PROGRESS',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        stackName: stackName,
        region: awsRegion,
        phase: 'CLOUDFORMATION_CREATING'
      }, null, 2)
    );
    
    // 创建CloudFormation Stack
    const stackResult = await CloudFormationManager.createEKSStack({
      clusterTag,
      awsRegion,
      stackName
    }, cidrConfig);
    
    // 更新创建状态，添加Stack ID
    fs.writeFileSync(
      path.join(metadataDir, 'creation_status.json'),
      JSON.stringify({
        status: 'IN_PROGRESS',
        createdAt: new Date().toISOString(),
        lastUpdated: new Date().toISOString(),
        stackName: stackName,
        stackId: stackResult.stackId,
        region: awsRegion,
        phase: 'CLOUDFORMATION_IN_PROGRESS'
      }, null, 2)
    );
    
    // 更新creating-clusters跟踪文件
    creatingClusters[clusterTag].stackId = stackResult.stackId;
    creatingClusters[clusterTag].phase = 'CLOUDFORMATION_IN_PROGRESS';
    creatingClusters[clusterTag].lastUpdated = new Date().toISOString();
    fs.writeFileSync(creatingClustersPath, JSON.stringify(creatingClusters, null, 2));
    
    await clusterManager.saveCreationConfig(clusterTag, clusterConfig, cidrConfig, stackResult);
    
    // 发送WebSocket通知
    broadcast({
      type: 'cluster_creation_started',
      status: 'success',
      message: `EKS cluster creation started: ${clusterTag}`,
      clusterTag,
      stackName: stackResult.stackName
    });
    
    res.json({
      success: true,
      clusterTag,
      stackName: stackResult.stackName,
      stackId: stackResult.stackId,
      cidrConfig,
      message: 'EKS cluster creation started successfully'
    });
  } catch (error) {
    console.error('Error creating EKS cluster:', error);
    
    broadcast({
      type: 'cluster_creation_started',
      status: 'error',
      message: `Failed to create EKS cluster: ${error.message}`
    });
    
    res.status(500).json({ error: error.message });
  }
});

// HyperPod创建状态管理
const CREATING_HYPERPOD_CLUSTERS_FILE = path.join(__dirname, '../managed_clusters_info/creating-hyperpod-clusters.json');

function getCreatingHyperPodClusters() {
  try {
    if (fs.existsSync(CREATING_HYPERPOD_CLUSTERS_FILE)) {
      return JSON.parse(fs.readFileSync(CREATING_HYPERPOD_CLUSTERS_FILE, 'utf8'));
    }
    return {};
  } catch (error) {
    console.error('Error reading creating HyperPod clusters file:', error);
    return {};
  }
}

function updateCreatingHyperPodStatus(clusterTag, statusUpdate) {
  try {
    const creatingClusters = getCreatingHyperPodClusters();
    
    if (statusUpdate === 'COMPLETED') {
      // 移除已完成的集群
      delete creatingClusters[clusterTag];
    } else {
      // 更新或添加集群状态
      creatingClusters[clusterTag] = {
        ...creatingClusters[clusterTag],
        ...statusUpdate,
        lastUpdated: new Date().toISOString()
      };
    }
    
    fs.writeFileSync(CREATING_HYPERPOD_CLUSTERS_FILE, JSON.stringify(creatingClusters, null, 2));
  } catch (error) {
    console.error('Error updating creating HyperPod clusters status:', error);
  }
}

async function registerCompletedHyperPod(clusterTag) {
  try {
    console.log(`HyperPod cluster ${clusterTag} creation completed`);
    
    // 配置HyperPod自定义依赖
    await HyperPodDependencyManager.configureHyperPodDependencies(clusterTag, clusterManager);
    
  } catch (error) {
    console.error('Error registering completed HyperPod:', error);
    // 不抛出错误，避免影响主流程
  }
}

// 辅助函数：更新creating-clusters状态
function updateCreatingClustersStatus(clusterTag, status, additionalData = {}) {
  const fs = require('fs');
  const path = require('path');
  const creatingClustersPath = path.join(__dirname, '../managed_clusters_info/creating-clusters.json');
  
  let creatingClusters = {};
  if (fs.existsSync(creatingClustersPath)) {
    creatingClusters = JSON.parse(fs.readFileSync(creatingClustersPath, 'utf8'));
  }
  
  if (creatingClusters[clusterTag]) {
    if (status === 'COMPLETED' || status === 'FAILED') {
      // 创建完成或失败，从跟踪文件中移除
      delete creatingClusters[clusterTag];
    } else {
      // 更新状态
      creatingClusters[clusterTag] = {
        ...creatingClusters[clusterTag],
        status: status,
        lastUpdated: new Date().toISOString(),
        ...additionalData
      };
    }
    fs.writeFileSync(creatingClustersPath, JSON.stringify(creatingClusters, null, 2));
  }
}

// 获取正在创建的集群列表
app.get('/api/cluster/creating-clusters', async (req, res) => {
  try {
    const fs = require('fs');
    const path = require('path');
    const creatingClustersPath = path.join(__dirname, '../managed_clusters_info/creating-clusters.json');
    
    if (!fs.existsSync(creatingClustersPath)) {
      return res.json({ success: true, clusters: {} });
    }
    
    const creatingClusters = JSON.parse(fs.readFileSync(creatingClustersPath, 'utf8'));
    
    // 检查状态并处理完成的集群
    for (const [clusterTag, clusterInfo] of Object.entries(creatingClusters)) {
      if (clusterInfo.type === 'eks' && clusterInfo.stackName) {
        try {
          const stackStatus = await CloudFormationManager.getStackStatus(clusterInfo.stackName, clusterInfo.region);
          clusterInfo.currentStackStatus = stackStatus.stackStatus;
          
          // 如果EKS集群创建完成，触发依赖配置
          if (stackStatus.stackStatus === 'CREATE_COMPLETE') {
            console.log(`EKS cluster ${clusterTag} creation completed, configuring dependencies...`);
            
            // 异步配置依赖，不阻塞API响应
            setImmediate(async () => {
              try {
                await configureClusterDependencies(clusterTag);
              } catch (error) {
                console.error(`Failed to configure dependencies for ${clusterTag}:`, error);
              }
            });
          } else if (stackStatus.stackStatus.includes('FAILED') || stackStatus.stackStatus.includes('ROLLBACK')) {
            // 创建失败，清理状态
            console.log(`EKS cluster ${clusterTag} creation failed, cleaning up...`);
            updateCreatingClustersStatus(clusterTag, 'COMPLETED');
          }
          
        } catch (error) {
          console.error(`Error checking status for cluster ${clusterTag}:`, error);
          clusterInfo.currentStackStatus = 'UNKNOWN';
          
          // 如果stack不存在，清理状态
          if (error.message && error.message.includes('does not exist')) {
            console.log(`Stack for ${clusterTag} does not exist, cleaning up...`);
            updateCreatingClustersStatus(clusterTag, 'COMPLETED');
          }
        }
      }
    }
    
    res.json({ success: true, clusters: creatingClusters });
  } catch (error) {
    console.error('Error getting creating clusters:', error);
    res.status(500).json({ error: error.message });
  }
});

// 配置集群依赖（helm等）
async function configureClusterDependencies(clusterTag) {
  try {
    console.log(`Configuring dependencies for cluster: ${clusterTag}`);
    
    // 使用ClusterDependencyManager进行配置
    await ClusterDependencyManager.configureClusterDependencies(clusterTag, clusterManager);
    
    console.log(`Successfully configured dependencies for cluster: ${clusterTag}`);
    
    // 更新状态为完成
    updateCreatingClustersStatus(clusterTag, 'COMPLETED');
    
    // 注册完成的集群
    await registerCompletedCluster(clusterTag);
    
  } catch (error) {
    console.error(`Error configuring dependencies for cluster ${clusterTag}:`, error);
    updateCreatingClustersStatus(clusterTag, 'DEPENDENCY_CONFIG_FAILED', { error: error.message });
    
    // 即使依赖配置失败，也要注册集群（让用户能看到集群）
    console.log(`Registering cluster ${clusterTag} despite dependency configuration failure`);
    try {
      await registerCompletedCluster(clusterTag, 'dependency-failed');
    } catch (registerError) {
      console.error(`Failed to register cluster ${clusterTag} after dependency failure:`, registerError);
    }
    
    throw error;
  }
}

// 注册完成的集群到可选列表
async function registerCompletedCluster(clusterTag, status = 'active') {
  try {
    console.log(`Registering completed cluster: ${clusterTag}`);
    
    const fs = require('fs');
    const path = require('path');
    
    // 读取创建时的metadata
    const metadataDir = clusterManager.getClusterMetadataDir(clusterTag);
    const creationMetadataPath = path.join(metadataDir, 'creation_metadata.json');
    
    if (!fs.existsSync(creationMetadataPath)) {
      console.error(`Creation metadata not found for cluster: ${clusterTag}`);
      return;
    }
    
    const creationMetadata = JSON.parse(fs.readFileSync(creationMetadataPath, 'utf8'));
    
    // 生成cluster_info.json（兼容现有格式）
    const clusterInfo = {
      clusterTag: clusterTag,
      region: creationMetadata.userConfig.awsRegion,
      status: status, // 使用传入的状态
      type: 'created',
      createdAt: creationMetadata.createdAt,
      lastModified: new Date().toISOString(),
      source: 'ui-panel-creation',
      cloudFormation: {
        stackName: creationMetadata.cloudFormation.stackName,
        stackId: creationMetadata.cloudFormation.stackId
      }
    };
    
    // 保存cluster_info.json
    const clusterInfoPath = path.join(metadataDir, 'cluster_info.json');
    fs.writeFileSync(clusterInfoPath, JSON.stringify(clusterInfo, null, 2));
    
    console.log(`Successfully registered cluster: ${clusterTag}`);
    
    // 自动设置为active cluster
    try {
      await clusterManager.setActiveCluster(clusterTag);
      console.log(`Set ${clusterTag} as active cluster`);
    } catch (error) {
      console.error(`Failed to set ${clusterTag} as active cluster:`, error);
    }
    
    // 发送WebSocket通知
    broadcast({
      type: 'cluster_creation_completed',
      status: 'success',
      message: `EKS cluster created and registered: ${clusterTag}`,
      clusterTag: clusterTag
    });
    
  } catch (error) {
    console.error(`Failed to register completed cluster ${clusterTag}:`, error);
  }
}

// 清理creating metadata（不触碰CloudFormation）
function cleanupCreatingMetadata(clusterTag) {
  const fs = require('fs');
  const path = require('path');
  
  try {
    console.log(`Cleaning up creating metadata for: ${clusterTag}`);
    
    // 从creating-clusters.json中移除
    const creatingClustersPath = path.join(__dirname, '../managed_clusters_info/creating-clusters.json');
    if (fs.existsSync(creatingClustersPath)) {
      const creatingClusters = JSON.parse(fs.readFileSync(creatingClustersPath, 'utf8'));
      delete creatingClusters[clusterTag];
      fs.writeFileSync(creatingClustersPath, JSON.stringify(creatingClusters, null, 2));
    }
    
    // 删除集群目录（恢复到空白状态）
    const clusterDir = path.join(__dirname, '../managed_clusters_info', clusterTag);
    if (fs.existsSync(clusterDir)) {
      fs.rmSync(clusterDir, { recursive: true, force: true });
      console.log(`Removed cluster directory: ${clusterDir}`);
    }
    
    console.log(`Successfully cleaned up metadata for cluster: ${clusterTag}`);
    
  } catch (error) {
    console.error(`Error cleaning up metadata for cluster ${clusterTag}:`, error);
  }
}

// 检查集群依赖配置状态
app.get('/api/cluster/dependency-status/:clusterTag', async (req, res) => {
  try {
    const { clusterTag } = req.params;
    
    const clusterDir = clusterManager.getClusterDir(clusterTag);
    const configDir = path.join(clusterDir, 'config');
    
    if (!fs.existsSync(configDir)) {
      return res.status(404).json({ error: 'Cluster not found' });
    }
    
    const status = await ClusterDependencyManager.checkDependencyStatus(configDir);
    
    res.json({
      success: true,
      clusterTag,
      dependencyStatus: status
    });
    
  } catch (error) {
    console.error('Error checking dependency status:', error);
    res.status(500).json({ error: error.message });
  }
});

// 手动重新配置集群依赖（用于调试）
app.post('/api/cluster/reconfigure-dependencies/:clusterTag', async (req, res) => {
  try {
    const { clusterTag } = req.params;
    
    console.log(`Manual reconfiguration requested for cluster: ${clusterTag}`);
    
    // 先清理现有配置
    const clusterDir = clusterManager.getClusterDir(clusterTag);
    const configDir = path.join(clusterDir, 'config');
    
    await ClusterDependencyManager.cleanupDependencies(configDir);
    
    // 重新配置
    await ClusterDependencyManager.configureClusterDependencies(clusterTag, clusterManager);
    
    res.json({
      success: true,
      message: `Successfully reconfigured dependencies for cluster: ${clusterTag}`
    });
    
  } catch (error) {
    console.error('Error reconfiguring dependencies:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取集群创建状态
app.get('/api/cluster/creation-status/:clusterTag', async (req, res) => {
  try {
    const { clusterTag } = req.params;
    const fs = require('fs');
    const path = require('path');
    
    // 读取创建metadata获取region和stack信息
    const metadataDir = clusterManager.getClusterMetadataDir(clusterTag);
    const creationStatusPath = path.join(metadataDir, 'creation_status.json');
    
    if (!fs.existsSync(creationStatusPath)) {
      return res.status(404).json({ error: 'Creation status not found' });
    }
    
    const creationStatus = JSON.parse(fs.readFileSync(creationStatusPath, 'utf8'));
    const stackName = creationStatus.stackName;
    const region = creationStatus.region;
    
    if (!stackName || !region) {
      return res.status(400).json({ error: 'Missing stack name or region in metadata' });
    }
    
    const stackStatus = await CloudFormationManager.getStackStatus(stackName, region);
    
    res.json({
      success: true,
      clusterTag,
      stackName,
      region,
      ...stackStatus
    });
  } catch (error) {
    console.error('Error getting cluster creation status:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取集群创建日志
app.get('/api/cluster/creation-logs/:clusterTag', async (req, res) => {
  try {
    const { clusterTag } = req.params;
    
    // 读取集群配置
    const clusterInfo = await clusterManager.getClusterInfo(clusterTag);
    if (!clusterInfo) {
      return res.status(404).json({ error: 'Cluster not found' });
    }
    
    const stackName = `full-stack-${clusterTag}`;
    const events = await CloudFormationManager.getStackEvents(stackName, clusterInfo.awsRegion);
    
    res.json({
      success: true,
      clusterTag,
      stackName,
      events
    });
  } catch (error) {
    console.error('Error getting cluster creation logs:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取集群信息API
app.get('/api/cluster/info', async (req, res) => {
  try {
    const { promisify } = require('util');
    const execAsync = promisify(require('child_process').exec);
    
    const activeCluster = clusterManager.getActiveCluster();
    if (!activeCluster) {
      return res.status(400).json({ success: false, error: 'No active cluster selected' });
    }
    
    const initEnvsPath = path.join(__dirname, '../managed_clusters_info', activeCluster, 'config/init_envs');
    const stackEnvsPath = path.join(__dirname, '../managed_clusters_info', activeCluster, 'config/stack_envs');
    
    const getEnvVar = async (varName, filePath = initEnvsPath) => {
      try {
        const cmd = `source ${filePath} && echo $${varName}`;
        const result = await execAsync(cmd, { shell: '/bin/bash' });
        return result.stdout.trim();
      } catch (error) {
        return null;
      }
    };
    
    const eksClusterName = await getEnvVar('EKS_CLUSTER_NAME');
    const region = await getEnvVar('AWS_REGION');
    const vpcId = await getEnvVar('VPC_ID', stackEnvsPath);
    
    res.json({
      success: true,
      activeCluster,
      eksClusterName,
      region,
      vpcId
    });
  } catch (error) {
    console.error('Error getting cluster info:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取可用区列表API
app.get('/api/cluster/availability-zones', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const { region } = req.query;
    if (!region) {
      return res.status(400).json({ success: false, error: 'Region parameter required' });
    }
    
    const command = `aws ec2 describe-availability-zones --region ${region} --query 'AvailabilityZones[*].{ZoneName:ZoneName,ZoneId:ZoneId}' --output json`;
    const result = execSync(command, { encoding: 'utf8' });
    const zones = JSON.parse(result);
    
    res.json({
      success: true,
      zones
    });
  } catch (error) {
    console.error('Error getting availability zones:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// HyperPod集群创建API
app.post('/api/cluster/create-hyperpod', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(require('child_process').exec);
    const path = require('path');
    
    const { userConfig } = req.body;
    
    // 获取当前活跃集群信息
    const activeCluster = clusterManager.getActiveCluster();
    console.log('Active cluster:', activeCluster);
    if (!activeCluster) {
      return res.status(400).json({ success: false, error: 'No active cluster selected' });
    }
    
    // 检查kubectl连通性
    try {
      console.log('Testing kubectl connectivity...');
      const kubectlResult = execSync('kubectl cluster-info', { encoding: 'utf8', timeout: 15000 });
      console.log('kubectl cluster-info result:', kubectlResult);
    } catch (error) {
      console.error('kubectl connectivity test failed:', error.message);
      console.error('kubectl error details:', error);
      return res.status(400).json({ 
        success: false, 
        error: `EKS cluster not accessible via kubectl: ${error.message}` 
      });
    }
    
    // 获取EKS集群信息
    const initEnvsPath = path.join(__dirname, '../managed_clusters_info', activeCluster, 'config/init_envs');
    console.log('Init envs path:', initEnvsPath);
    const getEnvVar = async (varName) => {
      const cmd = `source ${initEnvsPath} && echo $${varName}`;
      const result = await execAsync(cmd, { shell: '/bin/bash' });
      return result.stdout.trim();
    };
    
    const eksStackName = await getEnvVar('CLOUD_FORMATION_FULL_STACK_NAME');
    const region = await getEnvVar('AWS_REGION');
    
    if (!eksStackName || !region) {
      return res.status(400).json({ success: false, error: 'Missing EKS cluster configuration' });
    }
    
    // 生成HyperPod配置
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
    const clusterTag = userConfig.clusterTag;
    const hyperPodStackName = `hyperpod-${clusterTag}-${timestamp}`;
    
    // 使用EKS集群标识作为HyperPod集群名称，保持命名一致性
    const eksClusterTag = activeCluster; // 使用EKS集群的标识
    const hyperPodClusterName = `hp-cluster-${eksClusterTag}`;
    
    // 获取可用区ID
    const azCommand = `aws ec2 describe-availability-zones --region ${region} --query "AvailabilityZones[?ZoneName=='${userConfig.availabilityZone}'].ZoneId" --output text`;
    const azResult = execSync(azCommand, { encoding: 'utf8' });
    const availabilityZoneId = azResult.trim();
    
    // 获取EKS基础设施信息
    const stackInfo = await CloudFormationManager.fetchStackInfo(eksStackName, region);
    
    // 生成CIDR配置
    const cidrResponse = await fetch('http://localhost:3001/api/cluster/generate-cidr-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        region: region
      })
    });
    const cidrConfig = await cidrResponse.json();
    
    console.log('Generated CIDR config:', cidrConfig);
    
    if (!cidrConfig.hyperPodPrivateSubnetCidr) {
      throw new Error('Failed to generate private subnet CIDR');
    }
    
    // 记录创建状态
    updateCreatingHyperPodStatus(activeCluster, {
      type: 'hyperpod',
      status: 'IN_PROGRESS',
      phase: 'CREATING_STACK',
      stackName: hyperPodStackName,
      region: region,
      createdAt: new Date().toISOString()
    });
    
    // 构建HyperPod配置
    const hyperPodConfig = {
      ResourceNamePrefix: clusterTag,
      AvailabilityZoneId: availabilityZoneId,
      PrivateSubnet1CIDR: cidrConfig.hyperPodPrivateSubnetCidr,
      HyperPodClusterName: hyperPodClusterName,
      NodeRecovery: 'None',
      UseContinuousNodeProvisioningMode: 'false',
      CreateAcceleratedInstanceGroup: 'true',
      AcceleratedInstanceGroupName: `accelerated-${clusterTag}`,
      AcceleratedInstanceType: userConfig.AcceleratedInstanceType,
      AcceleratedInstanceCount: userConfig.AcceleratedInstanceCount,
      AcceleratedEBSVolumeSize: userConfig.AcceleratedEBSVolumeSize,
      AcceleratedTrainingPlanArn: userConfig.AcceleratedTrainingPlanArn || '',
      // 自动设置threads per core：有training plan时为2，否则为1
      AcceleratedThreadsPerCore: userConfig.AcceleratedTrainingPlanArn ? 2 : 1,
      EnableInstanceStressCheck: 'false',
      EnableInstanceConnectivityCheck: 'false'
    };
    
    const stackResult = await CloudFormationManager.createHyperPodStack(
      hyperPodStackName,
      region,
      stackInfo,
      hyperPodConfig
    );
    
    // 保存配置到metadata
    await clusterManager.saveHyperPodConfig(activeCluster, {
      stackName: hyperPodStackName,
      stackId: stackResult.stackId,
      region: region,
      userConfig: userConfig,
      infrastructureInfo: stackInfo,
      createdAt: new Date().toISOString()
    });
    
    // 发送WebSocket通知
    broadcast({
      type: 'hyperpod_creation_started',
      status: 'success',
      message: `HyperPod cluster creation started: ${hyperPodStackName}`,
      clusterTag: activeCluster,
      stackName: hyperPodStackName
    });
    
    res.json({
      success: true,
      stackName: hyperPodStackName,
      stackId: stackResult.stackId,
      message: 'HyperPod cluster creation started'
    });
    
  } catch (error) {
    console.error('Error creating HyperPod cluster:', error);
    
    // 更新失败状态
    const activeCluster = clusterManager.getActiveCluster();
    if (activeCluster) {
      updateCreatingHyperPodStatus(activeCluster, {
        status: 'FAILED',
        error: error.message,
        failedAt: new Date().toISOString()
      });
    }
    
    broadcast({
      type: 'hyperpod_creation_failed',
      status: 'error',
      message: `HyperPod creation failed: ${error.message}`
    });
    
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取EKS节点组创建所需的子网信息
app.get('/api/cluster/subnets', async (req, res) => {
  try {
    const { promisify } = require('util');
    const execAsync = promisify(require('child_process').exec);
    const path = require('path');
    
    // 获取当前活跃集群信息
    const activeCluster = clusterManager.getActiveCluster();
    if (!activeCluster) {
      return res.status(400).json({ success: false, error: 'No active cluster selected' });
    }
    
    // 获取集群配置
    const initEnvsPath = path.join(__dirname, '../managed_clusters_info', activeCluster, 'config/init_envs');
    const getEnvVar = async (varName) => {
      const cmd = `source ${initEnvsPath} && echo $${varName}`;
      const result = await execAsync(cmd, { shell: '/bin/bash' });
      return result.stdout.trim();
    };
    
    const eksStackName = await getEnvVar('CLOUD_FORMATION_FULL_STACK_NAME');
    const region = await getEnvVar('AWS_REGION');
    const eksClusterName = await getEnvVar('EKS_CLUSTER_NAME');
    
    if (!eksStackName || !region) {
      return res.status(400).json({ success: false, error: 'Missing EKS cluster configuration' });
    }
    
    // 获取CloudFormation输出信息
    const stackInfo = await CloudFormationManager.fetchStackInfo(eksStackName, region);
    const vpcId = stackInfo.VPC_ID;
    
    if (!vpcId) {
      return res.status(400).json({ success: false, error: 'VPC ID not found in stack outputs' });
    }
    
    // 获取子网信息
    const subnetInfo = await CloudFormationManager.fetchSubnetInfo(vpcId, region);
    
    // 获取HyperPod使用的子网
    let hyperPodSubnets = [];
    try {
      const hpClusterName = eksClusterName.replace('eks-cluster-', 'hp-cluster-');
      const hpCmd = `aws sagemaker describe-cluster --cluster-name ${hpClusterName} --region ${region} --output json`;
      const hpResult = await execAsync(hpCmd);
      const hpData = JSON.parse(hpResult.stdout);
      
      // 从VpcConfig中提取HyperPod使用的子网ID
      if (hpData.VpcConfig && hpData.VpcConfig.Subnets) {
        hyperPodSubnets = hpData.VpcConfig.Subnets;
        console.log('Found HyperPod subnets:', hyperPodSubnets);
      }
    } catch (error) {
      console.log('No HyperPod cluster found or error fetching HyperPod subnets:', error.message);
    }
    
    // 标记HyperPod使用的子网
    const markedSubnets = {
      publicSubnets: subnetInfo.publicSubnets,
      privateSubnets: subnetInfo.privateSubnets.map(subnet => ({
        ...subnet,
        isHyperPodSubnet: hyperPodSubnets.includes(subnet.subnetId)
      })),
      hyperPodSubnets: hyperPodSubnets
    };
    
    res.json({
      success: true,
      data: {
        eksClusterName,
        region,
        vpcId,
        ...markedSubnets
      }
    });
    
  } catch (error) {
    console.error('Error fetching subnets:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 创建EKS节点组
app.post('/api/cluster/create-nodegroup', async (req, res) => {
  try {
    const { promisify } = require('util');
    const execAsync = promisify(require('child_process').exec);
    const { spawn } = require('child_process');
    const path = require('path');
    const EksNodeGroupDependencyManager = require('./utils/eksNodeGroupDependencyManager');
    
    const { userConfig } = req.body;
    
    // 获取当前活跃集群信息
    const activeCluster = clusterManager.getActiveCluster();
    if (!activeCluster) {
      return res.status(400).json({ success: false, error: 'No active cluster selected' });
    }
    
    // 获取集群配置
    const initEnvsPath = path.join(__dirname, '../managed_clusters_info', activeCluster, 'config/init_envs');
    const getEnvVar = async (varName) => {
      const cmd = `source ${initEnvsPath} && echo $${varName}`;
      const result = await execAsync(cmd, { shell: '/bin/bash' });
      return result.stdout.trim();
    };
    
    const eksClusterName = await getEnvVar('EKS_CLUSTER_NAME');
    const region = await getEnvVar('AWS_REGION');
    const eksStackName = await getEnvVar('CLOUD_FORMATION_FULL_STACK_NAME');
    
    // 获取CloudFormation输出信息
    const stackInfo = await CloudFormationManager.fetchStackInfo(eksStackName, region);
    
    // 获取子网信息
    const subnetInfo = await CloudFormationManager.fetchSubnetInfo(stackInfo.VPC_ID, region);
    
    // 创建节点组配置
    const createResult = await CloudFormationManager.createEksNodeGroup(
      userConfig, 
      region, 
      eksClusterName,
      stackInfo.VPC_ID,
      stackInfo.SECURITY_GROUP_ID,
      subnetInfo
    );

    // 异步执行eksctl命令
    const childProcess = spawn('eksctl', ['create', 'nodegroup', '-f', createResult.configFile], {
      stdio: 'pipe'
    });
    
    let output = '';
    let errorOutput = '';
    
    childProcess.stdout.on('data', (data) => {
      output += data.toString();
      console.log('eksctl stdout:', data.toString());
    });
    
    childProcess.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log('eksctl stderr:', data.toString());
    });
    
    childProcess.on('close', async (code) => {
      // 清理临时文件
      require('fs').unlinkSync(createResult.configFile);
      
      if (code === 0) {
        broadcast({
          type: 'nodegroup_creation_completed',
          status: 'success',
          message: `EKS node group ${userConfig.nodeGroupName} created successfully`
        });
        
        // 自动配置节点组依赖
        try {
          console.log(`Starting dependency configuration for node group: ${userConfig.nodeGroupName}`);
          
          broadcast({
            type: 'nodegroup_dependencies_started',
            status: 'info',
            message: `Configuring dependencies for node group: ${userConfig.nodeGroupName}`
          });
          
          await EksNodeGroupDependencyManager.configureNodeGroupDependencies(
            activeCluster, 
            userConfig.nodeGroupName, 
            clusterManager
          );
          
          broadcast({
            type: 'nodegroup_dependencies_completed',
            status: 'success',
            message: `Node group dependencies configured successfully: ${userConfig.nodeGroupName}`
          });
          
        } catch (error) {
          console.error('Error configuring node group dependencies:', error);
          broadcast({
            type: 'nodegroup_dependencies_failed',
            status: 'error',
            message: `Node group dependencies failed: ${error.message}`
          });
        }
      } else {
        broadcast({
          type: 'nodegroup_creation_failed',
          status: 'error',
          message: `EKS node group creation failed: ${errorOutput}`
        });
      }
    });
    
    // 立即返回成功响应
    broadcast({
      type: 'nodegroup_creation_started',
      status: 'info',
      message: `EKS node group creation started: ${userConfig.nodeGroupName}`
    });
    
    res.json({
      success: true,
      message: 'EKS node group creation started',
      nodeGroupName: userConfig.nodeGroupName
    });
    
  } catch (error) {
    console.error('Error creating EKS node group:', error);
    
    broadcast({
      type: 'nodegroup_creation_failed',
      status: 'error',
      message: `EKS node group creation failed: ${error.message}`
    });
    
    res.status(500).json({ success: false, error: error.message });
  }
});

// 检查EKS节点组依赖状态
app.get('/api/cluster/:clusterTag/nodegroup/:nodeGroupName/dependencies/status', async (req, res) => {
  try {
    const { clusterTag, nodeGroupName } = req.params;
    const EksNodeGroupDependencyManager = require('./utils/eksNodeGroupDependencyManager');
    
    const clusterDir = clusterManager.getClusterDir(clusterTag);
    const configDir = path.join(clusterDir, 'config');
    
    const status = await EksNodeGroupDependencyManager.checkDependencyStatus(configDir, nodeGroupName);
    res.json(status);
    
  } catch (error) {
    console.error('Error checking node group dependency status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 检查HyperPod依赖配置状态
app.get('/api/cluster/:clusterTag/hyperpod/dependencies/status', async (req, res) => {
  try {
    const { clusterTag } = req.params;
    
    const clusterDir = clusterManager.getClusterDir(clusterTag);
    const configDir = path.join(clusterDir, 'config');
    
    if (!fs.existsSync(configDir)) {
      return res.status(404).json({ error: 'Cluster not found' });
    }
    
    const status = await HyperPodDependencyManager.checkHyperPodDependencyStatus(configDir);
    
    res.json({
      success: true,
      clusterTag,
      hyperPodDependencyStatus: status
    });
    
  } catch (error) {
    console.error('Error checking HyperPod dependency status:', error);
    res.status(500).json({ error: error.message });
  }
});

// 获取HyperPod创建状态
app.get('/api/cluster/hyperpod-creation-status/:clusterTag', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const { clusterTag } = req.params;
    const creatingClusters = getCreatingHyperPodClusters();
    const status = creatingClusters[clusterTag];
    
    if (!status) {
      return res.json({ success: true, status: null });
    }
    
    // 检查CloudFormation状态
    if (status.stackName && status.region) {
      try {
        const checkCmd = `aws cloudformation describe-stacks --stack-name ${status.stackName} --region ${status.region} --query 'Stacks[0].StackStatus' --output text`;
        const stackStatus = execSync(checkCmd, { encoding: 'utf8', timeout: 10000 }).trim();
        
        if (stackStatus === 'CREATE_COMPLETE') {
          // 创建完成，清理状态并注册
          updateCreatingHyperPodStatus(clusterTag, 'COMPLETED');
          await registerCompletedHyperPod(clusterTag);
          
          broadcast({
            type: 'hyperpod_creation_completed',
            status: 'success',
            message: `HyperPod cluster created successfully: ${status.stackName}`,
            clusterTag: clusterTag
          });
          
          return res.json({ success: true, status: { ...status, cfStatus: 'CREATE_COMPLETE' } });
        } else if (stackStatus.includes('FAILED') || stackStatus.includes('ROLLBACK') || stackStatus.includes('DELETE')) {
          // 创建失败，自动清理记录
          console.log(`Auto-cleaning failed HyperPod creation: ${clusterTag}, status: ${stackStatus}`);
          updateCreatingHyperPodStatus(clusterTag, 'COMPLETED');
          
          broadcast({
            type: 'hyperpod_creation_failed',
            status: 'error',
            message: `HyperPod creation failed and cleaned up: ${stackStatus}`,
            clusterTag: clusterTag
          });
          
          return res.json({ success: true, status: null }); // 返回null表示已清理
        }
        
        status.cfStatus = stackStatus;
      } catch (error) {
        // Stack不存在，清理记录
        if (error.message.includes('does not exist')) {
          console.log(`Auto-cleaning non-existent HyperPod stack: ${clusterTag}`);
          updateCreatingHyperPodStatus(clusterTag, 'COMPLETED');
          return res.json({ success: true, status: null });
        }
        console.error(`Error checking CloudFormation status: ${error.message}`);
      }
    }
    
    res.json({ success: true, status });
  } catch (error) {
    console.error('Error getting HyperPod creation status:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 获取正在创建的HyperPod集群列表
app.get('/api/cluster/creating-hyperpod-clusters', async (req, res) => {
  try {
    const { execSync } = require('child_process');
    const creatingClusters = getCreatingHyperPodClusters();
    
    // 检查所有创建中集群的状态，自动清理失败/不存在的记录
    for (const [clusterTag, clusterInfo] of Object.entries(creatingClusters)) {
      if (clusterInfo.stackName && clusterInfo.region) {
        try {
          // 检查CloudFormation stack状态
          const checkCmd = `aws cloudformation describe-stacks --stack-name ${clusterInfo.stackName} --region ${clusterInfo.region} --query 'Stacks[0].StackStatus' --output text`;
          const stackStatus = execSync(checkCmd, { encoding: 'utf8', timeout: 10000 }).trim();
          
          if (stackStatus === 'CREATE_COMPLETE') {
            updateCreatingHyperPodStatus(clusterTag, 'COMPLETED');
            await registerCompletedHyperPod(clusterTag);
          } else if (stackStatus.includes('FAILED') || stackStatus.includes('ROLLBACK') || stackStatus.includes('DELETE')) {
            // 自动清理失败的记录
            console.log(`Auto-cleaning failed HyperPod creation: ${clusterTag}, status: ${stackStatus}`);
            updateCreatingHyperPodStatus(clusterTag, 'COMPLETED'); // 移除记录
          }
        } catch (error) {
          // Stack不存在或其他错误，清理记录
          if (error.message.includes('does not exist')) {
            console.log(`Auto-cleaning non-existent HyperPod stack: ${clusterTag}`);
            updateCreatingHyperPodStatus(clusterTag, 'COMPLETED'); // 移除记录
          } else {
            console.error(`Error checking status for ${clusterTag}:`, error.message);
          }
        }
      }
    }
    
    // 返回清理后的状态
    const updatedClusters = getCreatingHyperPodClusters();
    res.json({ success: true, data: updatedClusters });
  } catch (error) {
    console.error('Error getting creating HyperPod clusters:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 取消集群创建
app.post('/api/cluster/cancel-creation/:clusterTag', async (req, res) => {
  try {
    const { clusterTag } = req.params;
    
    // 读取集群配置
    const clusterInfo = await clusterManager.getClusterInfo(clusterTag);
    if (!clusterInfo) {
      return res.status(404).json({ error: 'Cluster not found' });
    }
    
    const stackName = `full-stack-${clusterTag}`;
    const result = await CloudFormationManager.cancelStackCreation(stackName, clusterInfo.awsRegion);
    
    // 发送WebSocket通知
    broadcast({
      type: 'cluster_creation_cancelled',
      status: 'success',
      message: `Cluster creation cancelled: ${clusterTag}`,
      clusterTag
    });
    
    res.json({
      success: true,
      clusterTag,
      ...result
    });
  } catch (error) {
    console.error('Error cancelling cluster creation:', error);
    
    broadcast({
      type: 'cluster_creation_cancelled',
      status: 'error',
      message: `Failed to cancel cluster creation: ${error.message}`
    });
    
    res.status(500).json({ error: error.message });
  }
});

console.log('EKS cluster creation APIs loaded');

app.listen(PORT, () => {
  console.log('🚀 ========================================');
  console.log('🚀 HyperPod InstantStart Server Started');
  console.log('🚀 ========================================');
  console.log(`📡 HTTP Server: http://localhost:${PORT}`);
  console.log(`🔌 WebSocket Server: ws://localhost:${WS_PORT}`);
  console.log(`🌐 Multi-cluster management: enabled`);
  console.log(`⏰ Server started at: ${new Date().toISOString()}`);
  console.log(`🖥️  Node.js version: ${process.version}`);
  console.log(`💾 Memory usage: ${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`);
  console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('🚀 ========================================');
  console.log('✅ Server is ready to accept connections');
});
