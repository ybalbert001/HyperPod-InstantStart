#!/usr/bin/env node

/**
 * CIDR生成工具测试脚本
 * 用于验证CIDR生成功能的正确性
 */

const CidrGenerator = require('./utils/cidrGenerator');

async function testCidrGenerator() {
  console.log('🧪 Testing CIDR Generator...\n');
  
  const region = 'us-west-2';
  
  try {
    // 测试1: 生成唯一CIDR
    console.log('📋 Test 1: Generate unique CIDR');
    const uniqueCidr = await CidrGenerator.generateUniqueCidr(region);
    console.log(`✅ Generated CIDR: ${uniqueCidr}\n`);
    
    // 测试2: 生成完整CIDR配置
    console.log('📋 Test 2: Generate full CIDR configuration');
    const fullConfig = await CidrGenerator.generateFullCidrConfiguration(region);
    console.log('✅ Full CIDR configuration:');
    console.log(JSON.stringify(fullConfig, null, 2));
    console.log();
    
    // 测试3: 验证CIDR格式
    console.log('📋 Test 3: Validate CIDR format');
    const validCidrs = ['10.100.0.0/16', '192.168.1.0/24', '172.16.0.0/12'];
    const invalidCidrs = ['10.100.0.0', '10.300.0.0/16', '10.100.0.0/33'];
    
    validCidrs.forEach(cidr => {
      const isValid = CidrGenerator.validateCidrFormat(cidr);
      console.log(`${isValid ? '✅' : '❌'} ${cidr}: ${isValid ? 'Valid' : 'Invalid'}`);
    });
    
    invalidCidrs.forEach(cidr => {
      const isValid = CidrGenerator.validateCidrFormat(cidr);
      console.log(`${!isValid ? '✅' : '❌'} ${cidr}: ${isValid ? 'Valid' : 'Invalid'} (expected invalid)`);
    });
    console.log();
    
    // 测试4: 检查CIDR冲突
    console.log('📋 Test 4: Check CIDR conflict');
    const testCidr = '10.100.0.0/16';
    const hasConflict = await CidrGenerator.checkCidrConflict(testCidr, region);
    console.log(`✅ CIDR ${testCidr} conflict check: ${hasConflict ? 'Conflicts' : 'Available'}\n`);
    
    // 测试5: 获取现有VPC CIDRs
    console.log('📋 Test 5: Get existing VPC CIDRs');
    const existingCidrs = await CidrGenerator.getExistingVpcCidrs(region);
    console.log(`✅ Found ${existingCidrs.length} existing VPC CIDRs in ${region}:`);
    existingCidrs.forEach(cidr => console.log(`   - ${cidr}`));
    console.log();
    
    // 测试6: 使用自定义VPC CIDR
    console.log('📋 Test 6: Generate configuration with custom VPC CIDR');
    try {
      const customConfig = await CidrGenerator.generateFullCidrConfiguration(region, '10.150.0.0/16');
      console.log('✅ Custom CIDR configuration:');
      console.log(`   VPC CIDR: ${customConfig.vpcCidr}`);
      console.log(`   Public Subnet 1: ${customConfig.publicSubnet1Cidr}`);
      console.log(`   Public Subnet 2: ${customConfig.publicSubnet2Cidr}`);
      console.log(`   EKS Private Subnet 1: ${customConfig.eksPrivateSubnet1Cidr}`);
      console.log(`   EKS Private Subnet 2: ${customConfig.eksPrivateSubnet2Cidr}`);
      console.log(`   HyperPod Private Subnet: ${customConfig.hyperPodPrivateSubnetCidr}`);
    } catch (error) {
      console.log(`❌ Custom CIDR test failed: ${error.message}`);
    }
    
    console.log('\n🎉 All tests completed!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
}

// 运行测试
if (require.main === module) {
  testCidrGenerator();
}

module.exports = testCidrGenerator;
