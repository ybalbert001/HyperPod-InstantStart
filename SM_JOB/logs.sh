#!/bin/bash

if [ $# -eq 1 ]; then
    JOB_NAME="$1"
    echo "📋 Using specified job: $JOB_NAME"
else
    JOB_NAME=$(kubectl get trainingjob --sort-by=.metadata.creationTimestamp -o jsonpath='{.items[-1:].spec.trainingJobName}')
    echo "📋 Latest job: $JOB_NAME"
fi

if [ -z "$JOB_NAME" ]; then
    echo "❌ No job name found"
    exit 1
fi

LOG_STREAMS=$(aws logs describe-log-streams --log-group-name /aws/sagemaker/TrainingJobs --log-stream-name-prefix $JOB_NAME --query 'logStreams[*].logStreamName' --output text)

if [ -z "$LOG_STREAMS" ]; then
    echo "⏳ No logs available yet for job: $JOB_NAME"
    exit 1
fi


FIRST_STREAM=$(echo $LOG_STREAMS | cut -d' ' -f1)
echo "📄 Log stream: $FIRST_STREAM"
echo "----------------------------------------"

aws logs tail /aws/sagemaker/TrainingJobs --log-stream-names "$FIRST_STREAM" --follow