#!/bin/sh
# Gera a identidade S3 a partir das variáveis de ambiente e sobe o SeaweedFS com gateway S3.
set -eu

: "${S3_ACCESS_KEY_ID:?S3_ACCESS_KEY_ID não definido}"
: "${S3_SECRET_ACCESS_KEY:?S3_SECRET_ACCESS_KEY não definido}"

cat > /etc/seaweedfs/s3.json <<JSON
{
  "identities": [
    {
      "name": "ebisu",
      "credentials": [{ "accessKey": "${S3_ACCESS_KEY_ID}", "secretKey": "${S3_SECRET_ACCESS_KEY}" }],
      "actions": ["Admin", "Read", "Write", "List", "Tagging"]
    }
  ]
}
JSON

exec weed server -dir=/data -ip=seaweedfs -ip.bind=0.0.0.0 -volume.max=0 -s3 -s3.port=8333 -s3.config=/etc/seaweedfs/s3.json
