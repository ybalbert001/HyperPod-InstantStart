const { exec } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const yaml = require('yaml');

class S3StorageManager {
  constructor() {
    this.storageConfigPath = path.join(__dirname, '../config/s3-storages.json');
    this.ensureConfigFile();
  }

  // 确保配置文件存在
  ensureConfigFile() {
    if (!fs.existsSync(this.storageConfigPath)) {
      fs.ensureDirSync(path.dirname(this.storageConfigPath));
      fs.writeJsonSync(this.storageConfigPath, { storages: [] });
    }
  }

  // 获取所有S3存储配置
  async getStorages() {
    try {
      const config = fs.readJsonSync(this.storageConfigPath);
      
      // 检测现有的S3 PV/PVC
      const existingStorages = await this.detectExistingS3Storages();
      
      // 合并配置文件中的存储和检测到的存储
      const allStorages = [...config.storages];
      
      for (let existing of existingStorages) {
        const found = allStorages.find(s => s.pvcName === existing.pvcName);
        if (!found) {
          allStorages.push(existing);
        }
      }
      
      // 检查每个存储的状态
      for (let storage of allStorages) {
        storage.status = await this.checkStorageStatus(storage.pvcName);
      }
      
      return { success: true, storages: allStorages };
    } catch (error) {
      console.error('Error getting S3 storages:', error);
      return { success: false, error: error.message };
    }
  }

  // 检测现有的S3存储
  async detectExistingS3Storages() {
    return new Promise((resolve) => {
      exec('kubectl get pvc -o json', (error, stdout) => {
        if (error) {
          resolve([]);
          return;
        }
        
        try {
          const pvcList = JSON.parse(stdout);
          const s3Storages = [];
          
          for (let pvc of pvcList.items || []) {
            // 检查是否是S3存储（通过volumeName查找对应的PV）
            if (pvc.spec.volumeName) {
              exec(`kubectl get pv ${pvc.spec.volumeName} -o json`, (pvError, pvStdout) => {
                if (!pvError) {
                  try {
                    const pv = JSON.parse(pvStdout);
                    if (pv.spec.csi && pv.spec.csi.driver === 's3.csi.aws.com') {
                      s3Storages.push({
                        name: pvc.metadata.name,
                        bucketName: pv.spec.csi.volumeAttributes?.bucketName || 'Unknown',
                        region: this.extractRegionFromPV(pv),
                        pvcName: pvc.metadata.name,
                        pvName: pv.metadata.name,
                        createdAt: pvc.metadata.creationTimestamp,
                        source: 'detected'
                      });
                    }
                  } catch (e) {
                    // 忽略解析错误
                  }
                }
              });
            }
          }
          
          // 等待所有PV检查完成
          setTimeout(() => resolve(s3Storages), 1000);
        } catch (e) {
          resolve([]);
        }
      });
    });
  }

  // 从PV中提取region信息
  extractRegionFromPV(pv) {
    const mountOptions = pv.spec.mountOptions || [];
    for (let option of mountOptions) {
      if (option.startsWith('region ')) {
        return option.replace('region ', '');
      }
    }
    return 'Unknown';
  }

  // 检查存储状态
  async checkStorageStatus(pvcName) {
    return new Promise((resolve) => {
      exec(`kubectl get pvc ${pvcName} -o jsonpath='{.status.phase}'`, (error, stdout) => {
        if (error) {
          resolve('Not Found');
        } else {
          resolve(stdout.trim() === 'Bound' ? 'Ready' : 'Pending');
        }
      });
    });
  }

  // 创建S3存储配置
  async createStorage(storageConfig) {
    try {
      const { name, bucketName, region } = storageConfig;
      const pvcName = `s3-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
      const pvName = `s3-pv-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

      // 创建PV YAML
      const pvYaml = {
        apiVersion: 'v1',
        kind: 'PersistentVolume',
        metadata: {
          name: pvName
        },
        spec: {
          capacity: {
            storage: '1200Gi'
          },
          accessModes: ['ReadWriteMany'],
          mountOptions: [
            'allow-delete',
            `region ${region}`
          ],
          csi: {
            driver: 's3.csi.aws.com',
            volumeHandle: `s3-csi-driver-volume-${name}`,
            volumeAttributes: {
              bucketName: bucketName
            }
          }
        }
      };

      // 创建PVC YAML
      const pvcYaml = {
        apiVersion: 'v1',
        kind: 'PersistentVolumeClaim',
        metadata: {
          name: pvcName
        },
        spec: {
          accessModes: ['ReadWriteMany'],
          storageClassName: '',
          resources: {
            requests: {
              storage: '1200Gi'
            }
          },
          volumeName: pvName
        }
      };

      // 应用PV
      const pvYamlStr = yaml.stringify(pvYaml);
      await this.applyKubernetesResource(pvYamlStr);

      // 应用PVC
      const pvcYamlStr = yaml.stringify(pvcYaml);
      await this.applyKubernetesResource(pvcYamlStr);

      // 保存配置
      const config = fs.readJsonSync(this.storageConfigPath);
      config.storages.push({
        name,
        bucketName,
        region,
        pvcName,
        pvName,
        createdAt: new Date().toISOString()
      });
      fs.writeJsonSync(this.storageConfigPath, config);

      return { success: true, pvcName, pvName };
    } catch (error) {
      console.error('Error creating S3 storage:', error);
      return { success: false, error: error.message };
    }
  }

  // 删除S3存储配置
  async deleteStorage(name) {
    try {
      const config = fs.readJsonSync(this.storageConfigPath);
      const storage = config.storages.find(s => s.name === name);
      
      if (!storage) {
        return { success: false, error: 'Storage not found' };
      }

      // 删除PVC和PV
      await this.deleteKubernetesResource('pvc', storage.pvcName);
      await this.deleteKubernetesResource('pv', storage.pvName);

      // 从配置中移除
      config.storages = config.storages.filter(s => s.name !== name);
      fs.writeJsonSync(this.storageConfigPath, config);

      return { success: true };
    } catch (error) {
      console.error('Error deleting S3 storage:', error);
      return { success: false, error: error.message };
    }
  }

  // 应用Kubernetes资源
  async applyKubernetesResource(yamlContent) {
    return new Promise((resolve, reject) => {
      const tempFile = `/tmp/k8s-resource-${Date.now()}.yaml`;
      fs.writeFileSync(tempFile, yamlContent);
      
      exec(`kubectl apply -f ${tempFile}`, (error, stdout, stderr) => {
        fs.removeSync(tempFile);
        if (error) {
          reject(new Error(`kubectl apply failed: ${stderr}`));
        } else {
          resolve(stdout);
        }
      });
    });
  }

  // 删除Kubernetes资源
  async deleteKubernetesResource(type, name) {
    return new Promise((resolve, reject) => {
      exec(`kubectl delete ${type} ${name} --ignore-not-found=true`, (error, stdout, stderr) => {
        if (error) {
          console.warn(`Warning deleting ${type} ${name}:`, stderr);
        }
        resolve(stdout);
      });
    });
  }

  // 生成增强的模型下载Job
  async generateEnhancedDownloadJob(config) {
    try {
      const { modelId, resources, s3Storage, hfToken } = config;
      
      // 生成短的模型标签，限制长度
      let modelTag = modelId.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
      if (modelTag.length > 20) {
        modelTag = modelTag.substring(0, 20);
      }
      
      // 生成短的时间戳
      const timestamp = Date.now().toString().slice(-8); // 只取最后8位
      const jobName = `model-dl-${modelTag}-${timestamp}`;
      
      // 确保名称不超过63字符
      const finalJobName = jobName.length > 63 ? jobName.substring(0, 63) : jobName;

      // 读取模板
      const templatePath = path.join(__dirname, '../templates/hf-download-configurable-template.yaml');
      let yamlContent = fs.readFileSync(templatePath, 'utf8');

      // 替换占位符
      yamlContent = yamlContent
        .replace(/MODEL_TAG/g, finalJobName)
        .replace(/HF_MODEL_ID/g, modelId)
        .replace(/CPU_REQUEST/g, resources.cpu.toString())
        .replace(/CPU_LIMIT/g, resources.cpu.toString())
        .replace(/MEMORY_REQUEST/g, `${resources.memory}Gi`)
        .replace(/MEMORY_LIMIT/g, `${resources.memory}Gi`)
        .replace(/S3_PVC_NAME/g, s3Storage);

      // 处理HF Token
      if (hfToken) {
        yamlContent = yamlContent.replace(
          'env:HF_TOKEN_ENV',
          `env:\n            - name: HF_TOKEN\n              value: "${hfToken}"`
        );
      } else {
        yamlContent = yamlContent.replace('env:HF_TOKEN_ENV', 'env:');
      }

      return { success: true, yamlContent, jobName: finalJobName };
    } catch (error) {
      console.error('Error generating enhanced download job:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = S3StorageManager;
