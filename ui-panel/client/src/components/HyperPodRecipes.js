import React, { useState } from 'react';
import { Tabs, Space } from 'antd';
import { 
  ExperimentOutlined, 
  RocketOutlined,
  FireOutlined,
  CodeOutlined,
  CloudOutlined
} from '@ant-design/icons';
import TrainingConfigPanel from './TrainingConfigPanel';
import VerlRecipePanel from './VerlRecipePanel';
import TorchRecipePanel from './TorchRecipePanel';
import ScriptRecipePanel from './ScriptRecipePanel';
import SageMakerJobPanel from './SageMakerJobPanel';

const { TabPane } = Tabs;

const HyperPodRecipes = ({ onLaunch, deploymentStatus }) => {
  const [activeTab, setActiveTab] = useState('script');

  const handleTabChange = (key) => {
    setActiveTab(key);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <Tabs 
        activeKey={activeTab} 
        onChange={handleTabChange}
        type="card"
        size="small"
        tabBarStyle={{ marginBottom: 16, flexShrink: 0 }}
        style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
      >
        <TabPane
          tab={
            <Space>
              <CodeOutlined />
              Script Recipe
            </Space>
          }
          key="script"
          style={{ height: '100%', overflow: 'hidden' }}
        >
          <div style={{ height: '100%', overflow: 'auto', paddingRight: '8px' }}>
            <ScriptRecipePanel 
              onLaunch={onLaunch}
              deploymentStatus={deploymentStatus}
            />
          </div>
        </TabPane>

        <TabPane
          tab={
            <Space>
              <FireOutlined />
              Torch Recipe
            </Space>
          }
          key="torch"
          style={{ height: '100%', overflow: 'hidden' }}
        >
          <div style={{ height: '100%', overflow: 'auto', paddingRight: '8px' }}>
            <TorchRecipePanel 
              onLaunch={onLaunch}
              deploymentStatus={deploymentStatus}
            />
          </div>
        </TabPane>

        <TabPane
          tab={
            <Space>
              <ExperimentOutlined />
              LlamaFactory Recipe
            </Space>
          }
          key="llamafactory"
          style={{ height: '100%', overflow: 'hidden' }}
        >
          <div style={{ height: '100%', overflow: 'auto', paddingRight: '8px' }}>
            <TrainingConfigPanel 
              onLaunch={onLaunch}
              deploymentStatus={deploymentStatus}
            />
          </div>
        </TabPane>
        
        <TabPane
          tab={
            <Space>
              <RocketOutlined />
              VERL Recipe
            </Space>
          }
          key="verl"
          style={{ height: '100%', overflow: 'hidden' }}
        >
          <div style={{ height: '100%', overflow: 'auto', paddingRight: '8px' }}>
            <VerlRecipePanel onLaunch={onLaunch} deploymentStatus={deploymentStatus} />
          </div>
        </TabPane>

        <TabPane
          tab={
            <Space>
              <CloudOutlined />
              SageMakerJob
            </Space>
          }
          key="sagemaker"
          style={{ height: '100%', overflow: 'hidden' }}
        >
          <div style={{ height: '100%', overflow: 'auto', paddingRight: '8px' }}>
            <SageMakerJobPanel onLaunch={onLaunch} deploymentStatus={deploymentStatus} />
          </div>
        </TabPane>
      </Tabs>
    </div>
  );
};

export default HyperPodRecipes;
