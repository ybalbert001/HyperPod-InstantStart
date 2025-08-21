# --exclude='dev.vibe' --exclude='*.md' --exclude='sync-to-release.sh'


rsync -av --exclude='node_modules/' --exclude='logs/' --exclude='tests/' --exclude='deployments/' \
  --exclude='README.md' --exclude="__pycache__" \
  model-deployment-ui/ /home/ubuntu/workspace/250807-HyperPod-InstantStart/ui-panel/


cd 250807-HyperPod-InstantStart
git add .
git commit -m 'ui'
git push



rsync -av --exclude='node_modules/' --exclude='logs/' --exclude='tests/' --exclude='deployments/' --exclude='training/' \
  --exclude='README.md' --exclude="__pycache__" \
  model-deployment-ui/ /home/ubuntu/workspace/HyperPod-InstantStart/ui-panel/


cd HyperPod-InstantStart
git add .
git commit -m 'ui'
git push






