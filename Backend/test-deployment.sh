#!/bin/bash

# Test script for the complete deployment
echo "🧪 Testing Catholic Charities AI Assistant Deployment"
echo "====================================================="

# Get stack outputs
echo "📋 Getting deployment information..."
STACK_NAME="CatholicCharitiesStack"

if ! aws cloudformation describe-stacks --stack-name "$STACK_NAME" >/dev/null 2>&1; then
    echo "❌ Stack '$STACK_NAME' not found. Please deploy first."
    exit 1
fi

# Extract outputs
API_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs[?OutputKey==`ApiGatewayUrl`].OutputValue' --output text)
CHAT_ENDPOINT=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs[?OutputKey==`ChatEndpoint`].OutputValue' --output text)
HEALTH_ENDPOINT=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs[?OutputKey==`HealthEndpoint`].OutputValue' --output text)
AMPLIFY_URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs[?OutputKey==`AmplifyAppUrl`].OutputValue' --output text)
QBUSINESS_ID=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs[?OutputKey==`QBusinessApplicationId`].OutputValue' --output text)
BUCKET_NAME=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].Outputs[?OutputKey==`DataBucketName`].OutputValue' --output text)

echo ""
echo "🔗 Deployment URLs:"
echo "  • API Gateway: $API_URL"
echo "  • Chat Endpoint: $CHAT_ENDPOINT"
echo "  • Health Endpoint: $HEALTH_ENDPOINT"
echo "  • Amplify App: $AMPLIFY_URL"
echo "  • Q Business ID: $QBUSINESS_ID"
echo "  • S3 Bucket: $BUCKET_NAME"
echo ""

# Test 1: Health Check
echo "1️⃣ Testing Health Endpoint..."
health_response=$(curl -s -w "HTTP_STATUS:%{http_code}" "$HEALTH_ENDPOINT")
health_status=$(echo "$health_response" | grep -o "HTTP_STATUS:[0-9]*" | cut -d: -f2)
health_body=$(echo "$health_response" | sed 's/HTTP_STATUS:[0-9]*$//')

if [ "$health_status" = "200" ]; then
    echo "✅ Health check passed"
    echo "   Response: $(echo "$health_body" | jq -r '.status' 2>/dev/null || echo "$health_body")"
else
    echo "❌ Health check failed (Status: $health_status)"
    echo "   Response: $health_body"
fi
echo ""

# Test 2: Chat Endpoint
echo "2️⃣ Testing Chat Endpoint..."
chat_payload='{"message": "How do I apply for assistance from Catholic Charities?"}'

chat_response=$(curl -s -w "HTTP_STATUS:%{http_code}" \
  -X POST \
  -H "Content-Type: application/json" \
  -d "$chat_payload" \
  "$CHAT_ENDPOINT")

chat_status=$(echo "$chat_response" | grep -o "HTTP_STATUS:[0-9]*" | cut -d: -f2)
chat_body=$(echo "$chat_response" | sed 's/HTTP_STATUS:[0-9]*$//')

if [ "$chat_status" = "200" ]; then
    echo "✅ Chat endpoint working"
    success=$(echo "$chat_body" | jq -r '.success' 2>/dev/null)
    message_preview=$(echo "$chat_body" | jq -r '.message' 2>/dev/null | cut -c1-100)
    source_count=$(echo "$chat_body" | jq -r '.sources | length' 2>/dev/null)
    
    echo "   Success: $success"
    echo "   Message preview: $message_preview..."
    echo "   Sources found: $source_count"
else
    echo "❌ Chat endpoint failed (Status: $chat_status)"
    echo "   Response: $chat_body"
fi
echo ""

# Test 3: S3 Bucket Contents
echo "3️⃣ Checking S3 Data Sources..."
s3_objects=$(aws s3 ls "s3://$BUCKET_NAME/data-sources/" --recursive 2>/dev/null | wc -l)
if [ "$s3_objects" -gt 0 ]; then
    echo "✅ Found $s3_objects files in S3 data sources"
    echo "   Files:"
    aws s3 ls "s3://$BUCKET_NAME/data-sources/" --recursive | head -5
else
    echo "⚠️  No files found in S3 data sources (web crawler will still work)"
fi
echo ""

# Test 4: Q Business Application Status
echo "4️⃣ Checking Q Business Application..."
qb_status=$(aws qbusiness get-application --application-id "$QBUSINESS_ID" --query 'status' --output text 2>/dev/null)
if [ "$qb_status" = "ACTIVE" ]; then
    echo "✅ Q Business application is active"
    
    # Check data sources
    data_sources=$(aws qbusiness list-data-sources --application-id "$QBUSINESS_ID" --query 'dataSources[].displayName' --output text 2>/dev/null)
    echo "   Data sources: $data_sources"
else
    echo "⚠️  Q Business application status: $qb_status"
fi
echo ""

# Test 5: Multiple Chat Requests
echo "5️⃣ Testing Multiple Chat Requests..."
test_messages=(
    "What services does Catholic Charities provide?"
    "How can I donate to Catholic Charities?"
    "What are your office hours?"
)

for i in "${!test_messages[@]}"; do
    message="${test_messages[$i]}"
    echo "   Test $((i+1)): $message"
    
    payload="{\"message\": \"$message\"}"
    response=$(curl -s -w "HTTP_STATUS:%{http_code}" \
      -X POST \
      -H "Content-Type: application/json" \
      -d "$payload" \
      "$CHAT_ENDPOINT")
    
    status=$(echo "$response" | grep -o "HTTP_STATUS:[0-9]*" | cut -d: -f2)
    
    if [ "$status" = "200" ]; then
        echo "   ✅ Request $((i+1)) successful"
    else
        echo "   ❌ Request $((i+1)) failed (Status: $status)"
    fi
done
echo ""

# Test 6: Amplify App Status
echo "6️⃣ Checking Amplify App..."
if curl -s --head "$AMPLIFY_URL" | head -n 1 | grep -q "200 OK"; then
    echo "✅ Amplify app is accessible"
    echo "   URL: $AMPLIFY_URL"
else
    echo "⚠️  Amplify app may still be building or not accessible"
    echo "   URL: $AMPLIFY_URL"
fi
echo ""

echo "🎉 Testing Complete!"
echo "==================="
echo ""
echo "📊 Summary:"
echo "  • API Gateway: $([ "$health_status" = "200" ] && echo "✅ Working" || echo "❌ Failed")"
echo "  • Chat Function: $([ "$chat_status" = "200" ] && echo "✅ Working" || echo "❌ Failed")"
echo "  • Q Business: $([ "$qb_status" = "ACTIVE" ] && echo "✅ Active" || echo "⚠️ $qb_status")"
echo "  • Data Sources: $([ "$s3_objects" -gt 0 ] && echo "✅ $s3_objects files" || echo "⚠️ Web crawler only")"
echo ""
echo "🚀 Your Catholic Charities AI Assistant is ready!"
echo "   Frontend: $AMPLIFY_URL"
echo "   API: $API_URL"
