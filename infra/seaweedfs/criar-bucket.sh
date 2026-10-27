#!/bin/sh
# Cria o bucket de anexos se ainda não existir (idempotente).
set -eu

: "${S3_BUCKET:?S3_BUCKET não definido}"

if echo "s3.bucket.list" | weed shell -master=seaweedfs:9333 | awk '{print $1}' | grep -qx "${S3_BUCKET}"; then
  echo "Bucket ${S3_BUCKET} já existe"
else
  echo "s3.bucket.create -name ${S3_BUCKET}" | weed shell -master=seaweedfs:9333
  echo "Bucket ${S3_BUCKET} criado"
fi
