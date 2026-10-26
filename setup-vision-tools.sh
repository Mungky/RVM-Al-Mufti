#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
.tools/venv/bin/python -m venv --without-pip .tools/vision
.tools/venv/bin/python -m pip --python .tools/vision/bin/python install --index-url https://download.pytorch.org/whl/cpu torch==2.14.1 torchvision==0.29.1
.tools/venv/bin/python -m pip --python .tools/vision/bin/python install --index-url https://pypi.org/simple 'ultralytics==8.4.173'
.tools/venv/bin/python -m pip --python .tools/vision/bin/python freeze > .tools/vision-requirements.lock

mkdir -p .tools/vision-models
for rvm_model_spec in YOLO26:yolo26n YOLO11:yolo11n YOLOv8:yolov8n; do
  rvm_model_repo="${rvm_model_spec%%:*}"
  rvm_model_name="${rvm_model_spec##*:}"
  if [[ ! -s ".tools/vision-models/$rvm_model_name.pt" ]]; then
    curl -fL --max-time 120 "https://huggingface.co/Ultralytics/$rvm_model_repo/resolve/main/$rvm_model_name.pt" -o ".tools/vision-models/$rvm_model_name.pt.download"
    mv ".tools/vision-models/$rvm_model_name.pt.download" ".tools/vision-models/$rvm_model_name.pt"
  fi
done
