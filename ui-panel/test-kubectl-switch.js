#!/usr/bin/env node

const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// 测试kubectl配置切换
async function testKubectlSwitch() {
  console.log('🔧 Testing kubectl configuration switch...\n');

  const clusters = [
    'hypd-instrt-0821t3az',
    'hypd-instrt-0821t2'
  ];

  for (const clusterTag of clusters) {
    console.log(`📋 Testing cluster: ${clusterTag}`);
    
    try {
      // 读取集群配置
      const configPath = path.join(__dirname, 'managed_clusters_info', clusterTag, 'config', 'init_envs');
      
      if (!fs.existsSync(configPath)) {
        console.log(`❌ Config not found: ${configPath}`);
        continue;
      }

      const envContent = fs.readFileSync(configPath, 'utf8');
      const awsRegionMatch = envContent.match(/export AWS_REGION=(.+)/);
      const eksClusterMatch = envContent.match(/export EKS_CLUSTER_NAME=(.+)/);
      
      if (!awsRegionMatch || !eksClusterMatch) {
        console.log(`❌ Missing AWS_REGION or EKS_CLUSTER_NAME in config`);
        continue;
      }

      const awsRegion = awsRegionMatch[1].replace(/['"]/g, '').trim();
      let eksClusterName = eksClusterMatch[1].replace(/['"]/g, '').trim();
      
      if (eksClusterName.includes('$CLUSTER_TAG')) {
        eksClusterName = eksClusterName.replace('$CLUSTER_TAG', clusterTag);
      }

      console.log(`   Region: ${awsRegion}`);
      console.log(`   EKS Cluster: ${eksClusterName}`);

      // 测试kubectl配置切换命令
      const command = `aws eks update-kubeconfig --region ${awsRegion} --name ${eksClusterName}`;
      console.log(`   Command: ${command}`);

      await new Promise((resolve, reject) => {
        exec(command, { timeout: 30000 }, (error, stdout, stderr) => {
          if (error) {
            console.log(`   ❌ Failed: ${error.message}`);
            if (stderr) console.log(`   Stderr: ${stderr}`);
          } else {
            console.log(`   ✅ Success: ${stdout.trim()}`);
            
            // 验证当前kubectl上下文
            exec('kubectl config current-context', (ctxError, ctxStdout) => {
              if (!ctxError) {
                console.log(`   📍 Current context: ${ctxStdout.trim()}`);
              }
            });
          }
          resolve();
        });
      });

      console.log('');
      
    } catch (error) {
      console.log(`❌ Error testing ${clusterTag}: ${error.message}\n`);
    }
  }

  console.log('🏁 Test completed');
}

// 运行测试
if (require.main === module) {
  testKubectlSwitch();
}

module.exports = testKubectlSwitch;
