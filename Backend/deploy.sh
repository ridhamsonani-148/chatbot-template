#!/usr/bin/env bash
set -euo pipefail

echo "🚀 Catholic Charities AI Assistant - Complete Deployment"
echo "========================================================"
echo ""

# Function to prompt for input with default
prompt_with_default() {
    local prompt="$1"
    local default="$2"
    local var_name="$3"
    
    if [ -z "${!var_name:-}" ]; then
        if [ -n "$default" ]; then
            read -rp "$prompt [$default]: " input
            eval "$var_name=\${input:-$default}"
        else
            read -rp "$prompt: " input
            eval "$var_name=\$input"
        fi
    fi
}

# Prompt for GitHub repository information
prompt_with_default "Enter GitHub repository URL" "" "GITHUB_URL"

# Parse GitHub URL
if [[ $GITHUB_URL =~ ^https://github\.com/([^/]+)/([^/]+)(\.git)?/?$ ]]; then
    GITHUB_OWNER="${BASH_REMATCH[1]}"
    GITHUB_REPO_NAME="${BASH_REMATCH[2]}"
    echo "✓ Detected: $GITHUB_OWNER/$GITHUB_REPO_NAME"
else
    prompt_with_default "Enter GitHub owner" "" "GITHUB_OWNER"
    prompt_with_default "Enter GitHub repository name" "" "GITHUB_REPO_NAME"
fi

# Prompt for other parameters
prompt_with_default "Enter GitHub token" "" "GITHUB_TOKEN"
prompt_with_default "Enter GitHub branch" "main" "GITHUB_BRANCH"
prompt_with_default "Enter CodeBuild project name" "CatholicCharitiesDeploy" "PROJECT_NAME"
prompt_with_default "Enter action (deploy/destroy)" "deploy" "ACTION"

# Validate action
ACTION=$(echo "$ACTION" | tr '[:upper:]' '[:lower:]')
if [[ "$ACTION" != "deploy" && "$ACTION" != "destroy" ]]; then
    echo "❌ Invalid action: '$ACTION'. Choose 'deploy' or 'destroy'."
    exit 1
fi

# Validate GitHub access
echo ""
echo "🔍 Validating GitHub access..."
repo_check=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO_NAME")
if echo "$repo_check" | grep -q "Not Found"; then
    echo "❌ Repository $GITHUB_OWNER/$GITHUB_REPO_NAME not found or token invalid."
    exit 1
fi
echo "✅ GitHub repository access confirmed"

# Check for data_source folder
echo "🔍 Checking for data_source folder..."
data_source_check=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO_NAME/contents/data_source")
if echo "$data_source_check" | grep -q "Not Found"; then
    echo "⚠️  Warning: data_source folder not found in repository"
    echo "   The system will still work with web crawler data only"
else
    echo "✅ data_source folder found"
fi

# Check for Backend/lambda folder
echo "🔍 Checking for Backend/lambda folder..."
lambda_check=$(curl -s -H "Authorization: token $GITHUB_TOKEN" "https://api.github.com/repos/$GITHUB_OWNER/$GITHUB_REPO_NAME/contents/Backend/lambda")
if echo "$lambda_check" | grep -q "Not Found"; then
    echo "❌ Backend/lambda folder not found in repository"
    echo "   Please ensure your lambda_function.py is in Backend/lambda/"
    exit 1
fi
echo "✅ Backend/lambda folder found"

# Create IAM role for CodeBuild
ROLE_NAME="${PROJECT_NAME}-service-role"
echo ""
echo "🔧 Setting up IAM role: $ROLE_NAME"

if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    echo "✓ IAM role exists"
    ROLE_ARN=$(aws iam get-role --role-name "$ROLE_NAME" --query 'Role.Arn' --output text)
else
    echo "✱ Creating IAM role..."
    TRUST_DOC='{
        "Version":"2012-10-17",
        "Statement":[{
            "Effect":"Allow",
            "Principal":{"Service":"codebuild.amazonaws.com"},
            "Action":"sts:AssumeRole"
        }]
    }'

    ROLE_ARN=$(aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document "$TRUST_DOC" \
        --query 'Role.Arn' --output text)

    echo "✱ Attaching policies..."
    aws iam attach-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-arn arn:aws:iam::aws:policy/AdministratorAccess

    echo "⏳ Waiting for IAM role to propagate..."
    sleep 15
fi

# Create or update CodeBuild project
echo ""
echo "🏗️  Setting up CodeBuild project: $PROJECT_NAME"

ENVIRONMENT='{
    "type": "LINUX_CONTAINER",
    "image": "aws/codebuild/standard:7.0",
    "computeType": "BUILD_GENERAL1_MEDIUM",
    "environmentVariables": [
        {"name": "GITHUB_TOKEN", "value": "'"$GITHUB_TOKEN"'", "type": "PLAINTEXT"},
        {"name": "GITHUB_OWNER", "value": "'"$GITHUB_OWNER"'", "type": "PLAINTEXT"},
        {"name": "GITHUB_REPO_NAME", "value": "'"$GITHUB_REPO_NAME"'", "type": "PLAINTEXT"},
        {"name": "GITHUB_BRANCH", "value": "'"$GITHUB_BRANCH"'", "type": "PLAINTEXT"},
        {"name": "ACTION", "value": "'"$ACTION"'", "type": "PLAINTEXT"}
    ]
}'

ARTIFACTS='{"type":"NO_ARTIFACTS"}'
SOURCE='{
    "type":"GITHUB",
    "location":"'"$GITHUB_URL"'",
    "buildspec":"Backend/buildspec.yml"
}'

# Try to create project, update if it exists
if aws codebuild create-project \
    --name "$PROJECT_NAME" \
    --source "$SOURCE" \
    --artifacts "$ARTIFACTS" \
    --environment "$ENVIRONMENT" \
    --service-role "$ROLE_ARN" \
    --output json \
    --no-cli-pager >/dev/null 2>&1; then
    echo "✅ CodeBuild project created"
else
    echo "✱ Updating existing CodeBuild project..."
    aws codebuild update-project \
        --name "$PROJECT_NAME" \
        --source "$SOURCE" \
        --artifacts "$ARTIFACTS" \
        --environment "$ENVIRONMENT" \
        --service-role "$ROLE_ARN" \
        --output json \
        --no-cli-pager >/dev/null
    echo "✅ CodeBuild project updated"
fi

# Start the build
echo ""
echo "🚀 Starting deployment..."
BUILD_ID=$(aws codebuild start-build \
    --project-name "$PROJECT_NAME" \
    --query 'build.id' \
    --output text \
    --no-cli-pager)

if [ $? -eq 0 ]; then
    echo "✅ Build started successfully!"
    echo "📋 Build ID: $BUILD_ID"
    echo ""
    echo "🎯 What's happening now:"
    echo "========================"
    echo ""
    echo "📁 Step 1: Downloading files from data_source folder to S3"
    echo "🤖 Step 2: Creating Q Business application with anonymous access"
    echo "🕷️  Step 3: Setting up web crawler for Catholic Charities websites"
    echo "⚡ Step 4: Deploying Lambda function from Backend/lambda/"
    echo "🌐 Step 5: Creating API Gateway with CORS configuration"
    echo "📱 Step 6: Setting up Amplify app with automatic API integration"
    echo ""
    echo "🔗 Monitor progress:"
    echo "  • CodeBuild: https://console.aws.amazon.com/codesuite/codebuild/projects/$PROJECT_NAME/build/$BUILD_ID"
    echo "  • CloudFormation: https://console.aws.amazon.com/cloudformation"
    echo ""
    echo "⏱️  Expected completion: 15-20 minutes"
    echo ""
    echo "💡 Tip: The build will output all URLs when complete!"
else
    echo "❌ Failed to start build"
    exit 1
fi

exit 0
