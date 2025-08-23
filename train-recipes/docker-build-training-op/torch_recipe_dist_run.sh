#!/bin/bash
# set -e

echo "Installing dependencies..."
echo "SMHP TRAINING OP NPROC_PER_NODE: ${NPROC_PER_NODE}"
echo "SMHP TRAINING OP NNODES: ${NNODES}"

LOCAL_WORKDIR=/docker_workspace

cd $LOCAL_WORKDIR

TORCH_RECIPE_DIRPATH=${TORCH_RECIPE_PY_PATH%/*}
PY_NAME=$(basename "$TORCH_RECIPE_PY_PATH")
cp -r $TORCH_RECIPE_DIRPATH/* ./

[ -f "requirements.txt" ] && pip install -r requirements.txt

## MLFlow Global ENVs
# runtag=$(date '+%Y%m%d_%H%M%S')
# export MLFLOW_RUN_NAME="torch-recipe-$runtag"


# # Generate post-train script
# echo "Generating post-train script..."
# cat > post_train.sh << 'EOF'
# #!/bin/bash
# # Post-train script to set MLflow tags in background
# nohup python set_mlflow_tags.py > /tmp/hyperpod/mlflow_tags.log 2>&1 &
# exit 0
# EOF

# chmod +x post_train.sh


    # --post-train-script=$LOCAL_WORKDIR/post_train.sh \

# Start training
# hyperpodrun \
#     --nnodes=${NNODES} --nproc-per-node=${NPROC_PER_NODE} \
#     --server-host=0.0.0.0 --server-port=8080 \
#     --tee=3 --log_dir=/tmp/hyperpod \
#     $LOCAL_WORKDIR/$PY_NAME \
#         $TORCH_RECIPE_PY_PARAMS

CMD="hyperpodrun \
    --nnodes=${NNODES} --nproc-per-node=${NPROC_PER_NODE} \
    --server-host=0.0.0.0 --server-port=8080 \
    --tee=3 --log_dir=/tmp/hyperpod \
    $LOCAL_WORKDIR/$PY_NAME \
        $TORCH_RECIPE_PY_PARAMS"

# 打印命令
echo "Executing hyperpodrun command:"
echo "$CMD"

eval "$CMD"
