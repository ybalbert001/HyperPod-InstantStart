const { exec } = require('child_process');

/**
 * 获取当前AWS配置的region
 * @returns {Promise<string>} AWS region
 */
async function getCurrentRegion() {
  return new Promise((resolve, reject) => {
    exec('aws configure get region', (error, stdout, stderr) => {
      if (error) {
        console.error('Failed to get AWS region:', error);
        resolve('us-west-1'); // 默认region
        return;
      }
      
      const region = stdout.trim();
      resolve(region || 'us-west-1');
    });
  });
}

module.exports = {
  getCurrentRegion
};
