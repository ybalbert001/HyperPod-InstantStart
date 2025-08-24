#!/usr/bin/env python3
"""
MLflow Cross-Account Experiment Sync Tool
=========================================

Usage:
    python cross-acct-mlflow-sync.py --config-file contributor-config-john.json --experiment-id 123456789
"""

import mlflow
import mlflow.tracking
import boto3
import argparse
import os
import sys
import json
from datetime import datetime

def load_config(config_file):
    """加载配置文件"""
    with open(config_file, 'r') as f:
        return json.load(f)

def assume_role(role_arn):
    """假设跨账户角色"""
    sts = boto3.client('sts')
    response = sts.assume_role(
        RoleArn=role_arn,
        RoleSessionName=f'cross-acct-mlflow-sync-{datetime.now().strftime("%Y%m%d%H%M%S")}',
        DurationSeconds=3600
    )
    
    creds = response['Credentials']
    os.environ['AWS_ACCESS_KEY_ID'] = creds['AccessKeyId']
    os.environ['AWS_SECRET_ACCESS_KEY'] = creds['SecretAccessKey']
    os.environ['AWS_SESSION_TOKEN'] = creds['SessionToken']

def sync_experiment(config, experiment_id):
    """同步实验"""
    # 直接使用配置中的ARNs
    source_arn = config['source_mlflow_arn']
    target_arn = config['shared_mlflow_arn']
    contributor_tag = config['contributor_name']
    
    # 创建客户端
    source_client = mlflow.tracking.MlflowClient(tracking_uri=source_arn)
    target_client = mlflow.tracking.MlflowClient(tracking_uri=target_arn)
    
    # 获取源实验
    source_exp = source_client.get_experiment(experiment_id)
    target_exp_name = f"{source_exp.name}_{contributor_tag}"
    
    # 创建或获取目标实验
    try:
        target_exp = target_client.get_experiment_by_name(target_exp_name)
        target_exp_id = target_exp.experiment_id
    except:
        target_exp_id = target_client.create_experiment(
            name=target_exp_name,
            tags={
                'source_experiment_id': experiment_id,
                'contributor_tag': contributor_tag,
                'sync_timestamp': datetime.now().isoformat()
            }
        )
    
    # 同步runs
    runs = source_client.search_runs(experiment_ids=[experiment_id])
    print(f"Syncing {len(runs)} runs...")
    
    for run in runs:
        with target_client.start_run(experiment_id=target_exp_id) as target_run:
            # 同步参数
            for key, value in run.data.params.items():
                target_client.log_param(target_run.info.run_id, key, value)
            
            # 同步指标
            for key, value in run.data.metrics.items():
                target_client.log_metric(target_run.info.run_id, key, value)
            
            # 同步标签
            tags = run.data.tags.copy() if run.data.tags else {}
            tags.update({
                'source_run_id': run.info.run_id,
                'contributor_tag': contributor_tag,
                'sync_timestamp': datetime.now().isoformat()
            })
            
            for key, value in tags.items():
                target_client.set_tag(target_run.info.run_id, key, value)
    
    print(f"✅ Synced experiment '{source_exp.name}' -> '{target_exp_name}' ({len(runs)} runs)")

def main():
    parser = argparse.ArgumentParser(description='Sync MLflow experiment')
    parser.add_argument('--config-file', required=True, help='Configuration file')
    parser.add_argument('--experiment-id', required=True, help='Experiment ID to sync')
    args = parser.parse_args()
    
    try:
        # 加载配置
        config = load_config(args.config_file)
        
        # 假设角色
        assume_role(config['cross_account_role_arn'])
        
        # 同步实验
        sync_experiment(config, args.experiment_id)
        
    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()
