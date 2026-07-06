# Task 14 — CloudFront Setup (copy-pasteable AWS CLI)

**Bucket:** `pushpress-marketing-dev`  
**Region:** `us-east-1`  
**Run once** (steps 1–4), then per-site (step 5 onward).

## Prerequisites
```bash
export BUCKET="pushpress-marketing-dev"
export REGION="us-east-1"
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo "Account: $ACCOUNT_ID"   # should print a 12-digit number
```

## Step 1 — Origin Access Control (run once)
```bash
export OAC_ID=$(aws cloudfront create-origin-access-control \
  --origin-access-control-config \
    "Name=ploy-sites-oac,Description=OAC for Ploy gym sites,SigningProtocol=sigv4,SigningBehavior=always,OriginAccessControlOriginType=s3" \
  --query 'OriginAccessControl.Id' --output text)
echo "OAC_ID=$OAC_ID"
# Save this value — you need it for every distribution you create
```

## Step 2 — CloudFront URL rewrite function (run once)
```bash
cat > /tmp/ploy-url-rewrite.js << 'EOF'
function handler(event) {
  var request = event.request;
  var uri = request.uri;
  if (uri.endsWith('/')) {
    request.uri = uri + 'index.html';
  } else if (!uri.includes('.')) {
    request.uri = uri + '/index.html';
  }
  return request;
}
EOF

FUNC_ETAG=$(aws cloudfront create-function \
  --name ploy-url-rewrite \
  --function-config "Comment=Rewrite /path to /path/index.html,Runtime=cloudfront-js-2.0" \
  --function-code fileb:///tmp/ploy-url-rewrite.js \
  --query 'ETag' --output text)

export FUNC_ARN=$(aws cloudfront publish-function \
  --name ploy-url-rewrite \
  --if-match "$FUNC_ETAG" \
  --query 'FunctionSummary.FunctionMetadata.FunctionARN' --output text)
echo "FUNC_ARN=$FUNC_ARN"
# Save this value — you need it for every distribution you create
```

## Step 3 — S3 bucket policy (run once, covers all sites)
```bash
aws s3api put-bucket-policy \
  --bucket "pushpress-marketing-dev" \
  --policy "{
    \"Version\": \"2012-10-17\",
    \"Statement\": [{
      \"Sid\": \"AllowCloudFrontOAC\",
      \"Effect\": \"Allow\",
      \"Principal\": { \"Service\": \"cloudfront.amazonaws.com\" },
      \"Action\": \"s3:GetObject\",
      \"Resource\": \"arn:aws:s3:::pushpress-marketing-dev/sites/*\",
      \"Condition\": {
        \"StringLike\": {
          \"AWS:SourceArn\": \"arn:aws:cloudfront::${ACCOUNT_ID}:distribution/*\"
        }
      }
    }]
  }"
echo "Bucket policy applied"
```

## Step 4 — DNS wildcard (in your DNS provider, run once)
Point your preview subdomain at CloudFront:
```
*.ploysites.com   CNAME   <you will get this domain in step 5>
```
(Or whatever your preview domain is — update `PREVIEW_DOMAIN` in your env if different.)

---

## Step 5 — Create a distribution (run once per site)

First, get the site UUID from your DB:
```bash
# In psql or your DB tool:
# SELECT uuid, name, source_url FROM sites LIMIT 10;

export SITE_UUID="paste-site-uuid-here"
```

Then create the distribution:
```bash
export DIST_DOMAIN=$(aws cloudfront create-distribution \
  --distribution-config "{
    \"CallerReference\": \"ploy-${SITE_UUID}\",
    \"Comment\": \"Ploy mirror: ${SITE_UUID}\",
    \"Enabled\": true,
    \"HttpVersion\": \"http2\",
    \"PriceClass\": \"PriceClass_100\",
    \"DefaultRootObject\": \"index.html\",
    \"Origins\": {
      \"Quantity\": 1,
      \"Items\": [{
        \"Id\": \"ploy-${SITE_UUID}\",
        \"DomainName\": \"pushpress-marketing-dev.s3.us-east-1.amazonaws.com\",
        \"OriginPath\": \"/sites/${SITE_UUID}/current\",
        \"S3OriginConfig\": { \"OriginAccessIdentity\": \"\" },
        \"OriginAccessControlId\": \"${OAC_ID}\"
      }]
    },
    \"DefaultCacheBehavior\": {
      \"TargetOriginId\": \"ploy-${SITE_UUID}\",
      \"ViewerProtocolPolicy\": \"redirect-to-https\",
      \"AllowedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"] },
      \"CachedMethods\": { \"Quantity\": 2, \"Items\": [\"GET\",\"HEAD\"] },
      \"Compress\": true,
      \"ForwardedValues\": { \"QueryString\": false, \"Cookies\": { \"Forward\": \"none\" } },
      \"MinTTL\": 0, \"DefaultTTL\": 86400, \"MaxTTL\": 31536000,
      \"FunctionAssociations\": {
        \"Quantity\": 1,
        \"Items\": [{ \"FunctionARN\": \"${FUNC_ARN}\", \"EventType\": \"viewer-request\" }]
      }
    }
  }" \
  --query 'Distribution.DomainName' --output text)

echo "Distribution domain: $DIST_DOMAIN"
# → something like d3abc123xyz.cloudfront.net
# Distributions take ~5 minutes to deploy globally before they respond
```

## Step 6 — Update your .env
```bash
# Replace CDN_BASE_URL with the CloudFront domain:
# CDN_BASE_URL="https://<dist-domain>.cloudfront.net"
#
# For multiple sites you'll eventually want per-site routing.
# For now, store the dist domain in the DB alongside the site UUID
# (a sites.metadata column or a new sites.cloudfrontDomain column).
```

## Step 7 — Verify (wait ~5 min after creating distribution)
```bash
curl -sI "https://${DIST_DOMAIN}/" | grep -E "HTTP|content-type|x-cache"
curl -sI "https://${DIST_DOMAIN}/robots.txt" | grep -E "HTTP|content-type"
# Expect: HTTP/2 200 for both
# x-cache: Hit from cloudfront (after first request warms the cache)
```

## Notes
- Default CloudFront limit is 200 distributions per account. Request a limit increase before you have >150 sites.
- The long-term architecture is one distribution with CloudFront KeyValueStore routing subdomains to site prefixes — but that's a later optimization.
- For custom domains (cutover): add the gym's domain as an Alternate Domain Name on the distribution and attach an ACM certificate (us-east-1 region, required for CloudFront).
